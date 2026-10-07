"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { AgentSession, AomiClient } from "@aomi-labs/client";
import { UserState as UserStateHelpers } from "@aomi-labs/client";

import { useThreadContext } from "../contexts/thread-context";
import { useUser } from "../contexts/ext-user-context";
import { initThreadControl, type ThreadMetadata } from "../state/thread-store";
import {
  isPlaceholderTitle,
  reconcileGeneratedThreadTitle,
} from "./thread-title";
import { SessionManager } from "./session-manager";
import { getHttpStatus } from "./http-status";

const THREAD_PREFETCH_LIMIT = 5;
const PREFETCH_IDLE_TIMEOUT_MS = 1500;
// On a fresh login the wallet reports "connected" (isConnected -> true) before
// the SIWE / provider sign-in has written the Better Auth session cookie.
// Until that cookie exists the same-origin BFF proxy forwards the thread-list
// request anonymously and the backend answers 401. Signing (wallet popup +
// round-trip) routinely takes longer than a couple of seconds, so we retry 401s
// with capped exponential backoff for a generous-but-bounded budget instead of
// giving up after a fixed handful of attempts and stranding the list until a
// manual refresh. Backoff is capped low so threads appear within ~2s of the
// cookie landing; the budget bounds noise if sign-in is declined entirely.
const THREAD_LIST_AUTH_RETRY_BUDGET_MS = 30_000;
const THREAD_LIST_AUTH_RETRY_BASE_DELAY_MS = 300;
const THREAD_LIST_AUTH_RETRY_MAX_DELAY_MS = 2_000;
const THREAD_LIST_AUTH_RETRY_BACKOFF_FACTOR = 1.7;

type GlobalWithIdleCallback = typeof globalThis & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function scheduleBackgroundTask(task: () => void): () => void {
  const runtimeGlobal = globalThis as GlobalWithIdleCallback;

  if (typeof runtimeGlobal.requestIdleCallback === "function") {
    const idleId = runtimeGlobal.requestIdleCallback(task, {
      timeout: PREFETCH_IDLE_TIMEOUT_MS,
    });
    return () => runtimeGlobal.cancelIdleCallback?.(idleId);
  }

  const timeoutId = runtimeGlobal.setTimeout(task, 0);
  return () => runtimeGlobal.clearTimeout(timeoutId);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

type ThreadListSyncOptions = {
  aomiClientRef: MutableRefObject<AomiClient>;
  sessionManager: SessionManager;
  ensureInitialState: (threadId: string) => Promise<void>;
  /** Close and forget every chat (used when thread access goes away). */
  resetConversation: () => void;
  remoteThreadIdsRef: MutableRefObject<Set<string>>;
  accountSessionAvailable?: boolean;
  restoringAccount?: boolean;
  /** Whose list this is; a new owner refetches it. */
  owner: object;
  restoredThreadId?: string;
  onInvalidRestoredThread?: () => void;
};

/**
 * Apply a fetched thread list without rolling back local changes made while
 * the request was in flight. The server's fields win, while
 * composer control belongs to the live client state.
 */
export function mergeThreadListMetadata(
  fetched: Map<string, ThreadMetadata>,
  latest: Map<string, ThreadMetadata>,
): Map<string, ThreadMetadata> {
  const merged = new Map<string, ThreadMetadata>();

  for (const [threadId, metadata] of fetched) {
    merged.set(threadId, {
      ...metadata,
      title: reconcileGeneratedThreadTitle(
        latest.get(threadId)?.title,
        metadata.title,
      ),
      control: latest.get(threadId)?.control ?? metadata.control,
    });
  }
  for (const [threadId, metadata] of latest) {
    if (!merged.has(threadId)) merged.set(threadId, metadata);
  }

  return merged;
}

export function initRemoteThreadControl() {
  return { ...initThreadControl(), agentMode: "auto" as const };
}

export function useThreadListSync({
  aomiClientRef,
  sessionManager,
  ensureInitialState,
  resetConversation,
  remoteThreadIdsRef,
  accountSessionAvailable = false,
  restoringAccount = false,
  owner,
  restoredThreadId,
  onInvalidRestoredThread,
}: ThreadListSyncOptions): {
  isThreadListLoading: boolean;
  threadListError: boolean;
} {
  const threadContext = useThreadContext();
  const threadContextRef = useRef(threadContext);
  threadContextRef.current = threadContext;
  const { user } = useUser();
  const [isThreadListLoading, setIsThreadListLoading] = useState(true);
  const [threadListError, setThreadListError] = useState(false);
  const [settledOwner, setSettledOwner] = useState<object | null>(null);
  const prefetchCancelRef = useRef<(() => void) | null>(null);
  const hadThreadAccessRef = useRef(false);
  const invalidRestoredThread = useRef(onInvalidRestoredThread);
  invalidRestoredThread.current = onInvalidRestoredThread;
  const isConnected = UserStateHelpers.isConnected(user) === true;
  const canLoadThreads = isConnected || accountSessionAvailable;

  const listThreadsWithAuthRetry = useCallback(
    async (isCancelled: () => boolean) => {
      let nextDelay = THREAD_LIST_AUTH_RETRY_BASE_DELAY_MS;
      let waitedMs = 0;

      for (;;) {
        try {
          return await aomiClientRef.current.agent.sessions.all();
        } catch (error) {
          // Only 401s are treated as transient (the sign-in cookie not being
          // ready yet). Anything else, a cancelled effect, or an exhausted
          // budget surfaces the error to the caller.
          if (
            isCancelled() ||
            getHttpStatus(error) !== 401 ||
            waitedMs >= THREAD_LIST_AUTH_RETRY_BUDGET_MS
          ) {
            throw error;
          }

          await delay(nextDelay);
          waitedMs += nextDelay;
          nextDelay = Math.min(
            Math.round(nextDelay * THREAD_LIST_AUTH_RETRY_BACKOFF_FACTOR),
            THREAD_LIST_AUTH_RETRY_MAX_DELAY_MS,
          );
        }
      }
    },
    [aomiClientRef],
  );

  const scheduleThreadPrefetch = useCallback(
    (threadIds: string[]) => {
      prefetchCancelRef.current?.();

      const prefetchThreadIds = Array.from(new Set(threadIds))
        .filter((threadId) => remoteThreadIdsRef.current.has(threadId))
        .slice(0, THREAD_PREFETCH_LIMIT);

      if (prefetchThreadIds.length === 0) {
        prefetchCancelRef.current = null;
        return;
      }

      let cancelled = false;
      const cancelScheduledTask = scheduleBackgroundTask(() => {
        void Promise.all(
          prefetchThreadIds.map(async (threadId) => {
            if (cancelled || !remoteThreadIdsRef.current.has(threadId)) return;
            if (sessionManager.get(threadId)?.getSnapshot().messages.length) {
              return;
            }

            try {
              await ensureInitialState(threadId);
            } catch (error) {
              console.debug("Failed to prefetch thread:", threadId, error);
            }
          }),
        );
      });

      prefetchCancelRef.current = () => {
        cancelled = true;
        cancelScheduledTask();
      };
    },
    [ensureInitialState, remoteThreadIdsRef, sessionManager],
  );

  useEffect(() => {
    if (restoringAccount) return;
    if (!canLoadThreads) {
      const previouslyHadThreadAccess = hadThreadAccessRef.current;
      hadThreadAccessRef.current = false;
      setIsThreadListLoading(false);
      setSettledOwner(null);
      prefetchCancelRef.current?.();
      prefetchCancelRef.current = null;
      if (
        previouslyHadThreadAccess &&
        (remoteThreadIdsRef.current.size > 0 || sessionManager.size > 0)
      )
        resetConversation();
      return;
    }

    hadThreadAccessRef.current = true;

    let cancelled = false;
    setIsThreadListLoading(true);
    setThreadListError(false);

    const fetchThreadList = async () => {
      try {
        const remoteThreadIdsAtFetchStart = new Set(remoteThreadIdsRef.current);
        const currentContext = threadContextRef.current;
        const threadList: AgentSession[] = await listThreadsWithAuthRetry(
          () => cancelled,
        );
        if (cancelled) return;

        const remoteThreadIds = new Set<string>();
        // An account change can reset the store after this effect started.
        // Read the latest metadata so the old account's chats never return.
        const previousMetadata = threadContextRef.current.allThreadsMetadata;
        const newMetadata = new Map<string, ThreadMetadata>();
        const baseThreadCount = threadContextRef.current.threadCnt;
        let maxChatNum = baseThreadCount;

        for (const thread of threadList) {
          remoteThreadIds.add(thread.id);
          const rawTitle = thread.title ?? "";
          const title = isPlaceholderTitle(rawTitle) ? "" : rawTitle;
          const serverLastActiveAt = thread.updatedAt;
          const lastActive =
            (serverLastActiveAt ??
              previousMetadata.get(thread.id)?.lastActiveAt) ||
            new Date().toISOString();
          const existingControl = previousMetadata.get(thread.id)?.control;
          newMetadata.set(thread.id, {
            title,
            status: thread.archived ? "archived" : "regular",
            lastActiveAt: lastActive,
            // Session summaries do not expose the execution target. Mark an
            // unseen remote thread as explicitly Auto so a device-wide Direct
            // preference cannot present the first app as its historical
            // target. Threads created in this client retain their exact local
            // control through existingControl and the commit-time merge.
            control: existingControl ?? initRemoteThreadControl(),
          });

          const match = title.match(/^Chat (\d+)$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxChatNum) {
              maxChatNum = num;
            }
          }
        }

        for (const [threadId, metadata] of previousMetadata.entries()) {
          if (!newMetadata.has(threadId)) {
            newMetadata.set(threadId, metadata);
          }
        }

        for (const threadId of remoteThreadIdsRef.current) {
          if (!remoteThreadIdsAtFetchStart.has(threadId)) {
            remoteThreadIds.add(threadId);
          }
        }

        remoteThreadIdsRef.current = remoteThreadIds;
        currentContext.setThreadMetadata((latestMetadata) =>
          mergeThreadListMetadata(newMetadata, latestMetadata),
        );
        if (maxChatNum > baseThreadCount) {
          currentContext.setThreadCnt(maxChatNum);
        }

        scheduleThreadPrefetch(threadList.map((thread) => thread.id));

        const activeThreadId = threadContextRef.current.currentThreadId;
        let threadIdToLoad = activeThreadId;
        const activeHasUserMessage = Boolean(
          sessionManager
            .get(activeThreadId)
            ?.getSnapshot()
            .messages.some((message) => message.sender === "user"),
        );

        if (
          restoredThreadId &&
          activeThreadId === restoredThreadId &&
          !remoteThreadIds.has(activeThreadId) &&
          !activeHasUserMessage
        ) {
          invalidRestoredThread.current?.();
          currentContext.setThreadMetadata((prev) => {
            const next = new Map(prev);
            next.delete(activeThreadId);
            return next;
          });
          const fallbackThread = threadList
            .filter((thread) => !thread.archived)
            .sort((a, b) => b.updatedAt - a.updatedAt)[0];

          if (fallbackThread) {
            threadIdToLoad = fallbackThread.id;
            currentContext.setCurrentThreadId(fallbackThread.id);
            currentContext.bumpThreadViewKey();
          } else {
            threadIdToLoad = currentContext.resetToDefault();
          }
        }

        if (remoteThreadIds.has(threadIdToLoad))
          await ensureInitialState(threadIdToLoad);
      } catch (error) {
        console.error("Failed to fetch thread list:", error);
        if (!cancelled) {
          setThreadListError(true);
        }
      } finally {
        if (!cancelled) {
          setSettledOwner(owner);
          setIsThreadListLoading(false);
        }
      }
    };

    void fetchThreadList();

    return () => {
      cancelled = true;
      prefetchCancelRef.current?.();
      prefetchCancelRef.current = null;
    };
  }, [
    canLoadThreads,
    restoringAccount,
    owner,
    ensureInitialState,
    listThreadsWithAuthRetry,
    remoteThreadIdsRef,
    resetConversation,
    scheduleThreadPrefetch,
    sessionManager,
    restoredThreadId,
  ]);

  return {
    // Access can settle in the same render that enables URL restoration.
    // Advertise loading before the request effect runs, until its first result.
    isThreadListLoading:
      restoringAccount ||
      (canLoadThreads && (isThreadListLoading || settledOwner !== owner)),
    threadListError,
  };
}
