"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type {
  AgentSession,
  AomiClient,
  SessionOriginFields,
} from "@aomi-labs/client";
import { UserState as UserStateHelpers } from "@aomi-labs/client";

import { useThreadContext } from "../contexts/thread-context";
import { useUser } from "../contexts/ext-user-context";
import { initThreadControl, type ThreadMetadata } from "../state/thread-store";
import {
  isPlaceholderTitle,
  reconcileGeneratedThreadTitle,
} from "./thread-title";
import { SessionManager } from "./session-manager";
import { displayKey, useAomiDisplayCache } from "../query/display-cache";
import { getHttpStatus } from "./http-status";

const THREAD_PREFETCH_LIMIT = 5;
// Background history reads never compete with the open chat for long.
const THREAD_PREFETCH_CONCURRENCY = 2;
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
  isThreadListRevalidating: boolean;
  threadListError: boolean;
  /** Account identity allows reading saved chats. */
  canLoadThreads: boolean;
} {
  const threadContext = useThreadContext();
  const threadContextRef = useRef(threadContext);
  threadContextRef.current = threadContext;
  const { user } = useUser();
  const [isThreadListLoading, setIsThreadListLoading] = useState(true);
  const [threadListError, setThreadListError] = useState(false);
  const [settledOwner, setSettledOwner] = useState<object | null>(null);
  // The first page is on screen while later pages still load.
  const [firstPageOwner, setFirstPageOwner] = useState<object | null>(null);
  // Live rows already replaced any saved preview for this owner.
  const liveListOwner = useRef<object | null>(null);
  // The owner this render belongs to. A page from a previous owner can land
  // before that owner's effect cleanup runs; it must not touch this list.
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const prefetchCancelRef = useRef<(() => void) | null>(null);
  const hadThreadAccessRef = useRef(false);
  const invalidRestoredThread = useRef(onInvalidRestoredThread);
  invalidRestoredThread.current = onInvalidRestoredThread;
  const isConnected = UserStateHelpers.isConnected(user) === true;
  const canLoadThreads = isConnected || accountSessionAvailable;

  const displayCache = useAomiDisplayCache();
  const displayAccount =
    displayCache?.scope.account ?? displayCache?.restoredAccount;
  const cacheKey =
    displayCache && displayAccount?.kind === "user"
      ? displayKey(
          { ...displayCache.scope, account: displayAccount },
          "threads",
        )
      : null;
  const cacheKeyId = cacheKey ? JSON.stringify(cacheKey) : null;
  const cachedThreads = useSyncExternalStore(
    useCallback(
      (notify) =>
        displayCache?.client.getQueryCache().subscribe(notify) ?? (() => {}),
      [displayCache?.client],
    ),
    () =>
      cacheKey
        ? displayCache?.client.getQueryData<AgentSession[]>(cacheKey)
        : undefined,
    () => undefined,
  );
  const [cachedOwner, setCachedOwner] = useState<object | null>(null);
  const appliedCache = useRef<{ key: string; owner: object } | null>(null);
  const cachedIds = useRef(new Set<string>());
  const cachedTitles = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    if (restoringAccount) return;
    if (appliedCache.current && appliedCache.current.key !== cacheKeyId) {
      // A preview can precede the first confirmed account; core has no old
      // authenticated owner to tear down in that case.
      resetConversation();
      appliedCache.current = null;
      cachedIds.current.clear();
      setCachedOwner(null);
    }
    if (
      !cachedThreads ||
      !cacheKeyId ||
      appliedCache.current?.owner === owner ||
      liveListOwner.current === owner
    )
      return;
    appliedCache.current = { key: cacheKeyId, owner };
    cachedIds.current = new Set(cachedThreads.map((thread) => thread.id));
    cachedTitles.current = new Map(
      cachedThreads.map((thread) => [thread.id, thread.title ?? ""]),
    );
    remoteThreadIdsRef.current = new Set([
      ...remoteThreadIdsRef.current,
      ...cachedIds.current,
    ]);
    hadThreadAccessRef.current = true;
    threadContextRef.current.setThreadMetadata((latest) => {
      const next = new Map(latest);
      for (const thread of cachedThreads) {
        if (isTelegramThread(thread)) continue;
        next.set(thread.id, {
          title: isPlaceholderTitle(thread.title ?? "") ? "" : thread.title!,
          status: thread.archived ? "archived" : "regular",
          lastActiveAt: thread.updatedAt,
          control: latest.get(thread.id)?.control ?? initRemoteThreadControl(),
          ...threadOrigin(thread),
        });
      }
      return next;
    });
    setCachedOwner(owner);
  }, [
    cacheKeyId,
    cachedThreads,
    owner,
    restoringAccount,
    resetConversation,
    remoteThreadIdsRef,
  ]);

  // Persist only sidebar summaries of acknowledged remote chats. Messages,
  // controls and credentials never enter the saved projection.
  useEffect(() => {
    if (
      !displayCache ||
      !cacheKey ||
      settledOwner !== owner ||
      restoringAccount ||
      !canLoadThreads
    )
      return;
    const rows = [...threadContext.allThreadsMetadata].flatMap(
      ([id, metadata]) =>
        remoteThreadIdsRef.current.has(id)
          ? [
              {
                id,
                title: metadata.title,
                archived: metadata.status === "archived",
                updatedAt:
                  typeof metadata.lastActiveAt === "number"
                    ? metadata.lastActiveAt
                    : Date.parse(metadata.lastActiveAt ?? "") || Date.now(),
                ...(metadata.origin ? { origin: metadata.origin } : {}),
                ...(metadata.originApp !== undefined
                  ? { origin_app: metadata.originApp }
                  : {}),
              },
            ]
          : [],
    );
    displayCache.client.setQueryData(cacheKey, rows);
  }, [
    displayCache,
    cacheKeyId,
    settledOwner,
    owner,
    restoringAccount,
    canLoadThreads,
    threadContext.allThreadsMetadata,
    remoteThreadIdsRef,
  ]);

  const previewingAccount =
    displayCache?.scope.account === undefined && cachedThreads !== undefined;

  const listThreadsWithAuthRetry = useCallback(
    async (
      isCancelled: () => boolean,
      signal: AbortSignal,
      onPage: (sessions: AgentSession[], more: boolean) => void,
    ) => {
      let nextDelay = THREAD_LIST_AUTH_RETRY_BASE_DELAY_MS;
      let waitedMs = 0;

      for (;;) {
        try {
          return await aomiClientRef.current.agent.sessions.all({
            signal,
            onPage,
          });
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
        const queue = [...prefetchThreadIds];
        const worker = async () => {
          for (
            let threadId = queue.shift();
            threadId !== undefined && !cancelled;
            threadId = queue.shift()
          ) {
            if (!remoteThreadIdsRef.current.has(threadId)) continue;
            if (sessionManager.get(threadId)?.getSnapshot().messages.length)
              continue;
            try {
              await ensureInitialState(threadId);
            } catch (error) {
              console.debug("Failed to prefetch thread:", threadId, error);
            }
          }
        };
        void Promise.all(
          Array.from({ length: THREAD_PREFETCH_CONCURRENCY }, worker),
        );
      });

      prefetchCancelRef.current = () => {
        cancelled = true;
        cancelScheduledTask();
      };
    },
    [ensureInitialState, remoteThreadIdsRef, sessionManager],
  );

  // A saved preview only matters while thread access is unknown. Once access
  // is confirmed, the preview ending must not start a second list request.
  const listMode = canLoadThreads
    ? "load"
    : previewingAccount
      ? "preview"
      : "off";

  useEffect(() => {
    if (restoringAccount) return;
    if (listMode !== "load") {
      if (listMode === "preview") return;
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
    const stale = () => cancelled || currentOwner.current !== owner;
    const controller = new AbortController();
    setIsThreadListLoading(true);
    setThreadListError(false);

    // The restored chat loads beside the list instead of after it. Its
    // history only renders for this chat; the list still decides below
    // whether the id belongs to this account.
    const restoredId =
      restoredThreadId &&
      threadContextRef.current.currentThreadId === restoredThreadId
        ? restoredThreadId
        : undefined;
    if (restoredId)
      ensureInitialState(restoredId).catch((error) =>
        console.debug("Failed to load restored chat:", restoredId, error),
      );

    const remoteThreadIdsAtFetchStart = new Set(remoteThreadIdsRef.current);
    const baseThreadCount = threadContextRef.current.threadCnt;

    /**
     * Apply listed sessions. A partial list only adds rows; the complete list
     * also drops saved rows the server no longer has.
     */
    const applyThreads = (threadList: AgentSession[], complete: boolean) => {
      const currentContext = threadContextRef.current;
      const remoteThreadIds = new Set<string>();
      // An account change can reset the store after this effect started.
      // Read the latest metadata so the old account's chats never return.
      const previousMetadata = currentContext.allThreadsMetadata;
      const newMetadata = new Map<string, ThreadMetadata>();
      let maxChatNum = baseThreadCount;

      for (const thread of threadList) {
        // The server keeps Telegram chats off the portal list; an older or
        // shared listing must not surface them either.
        if (isTelegramThread(thread)) continue;
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
          ...threadOrigin(thread),
        });

        const match = title.match(/^Chat (\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxChatNum) {
            maxChatNum = num;
          }
        }
      }

      if (complete) {
        for (const [threadId, metadata] of previousMetadata.entries()) {
          if (!newMetadata.has(threadId) && !cachedIds.current.has(threadId)) {
            newMetadata.set(threadId, metadata);
          }
        }
        for (const threadId of remoteThreadIdsRef.current) {
          if (
            !remoteThreadIdsAtFetchStart.has(threadId) &&
            !cachedIds.current.has(threadId)
          ) {
            remoteThreadIds.add(threadId);
          }
        }
        remoteThreadIdsRef.current = remoteThreadIds;
      } else {
        remoteThreadIdsRef.current = new Set([
          ...remoteThreadIdsRef.current,
          ...remoteThreadIds,
        ]);
      }
      liveListOwner.current = owner;

      currentContext.setThreadMetadata((latestMetadata) => {
        const latest = new Map(latestMetadata);
        for (const id of cachedIds.current) {
          if (complete && !remoteThreadIds.has(id) && !latest.get(id)?.pending)
            latest.delete(id);
          else if (
            newMetadata.has(id) &&
            latest.get(id)?.title === cachedTitles.current.get(id)
          )
            latest.delete(id);
        }
        if (complete) {
          cachedIds.current.clear();
          cachedTitles.current.clear();
        }
        return mergeThreadListMetadata(newMetadata, latest);
      });
      if (maxChatNum > currentContext.threadCnt) {
        currentContext.setThreadCnt(maxChatNum);
      }
    };

    const fetchThreadList = async () => {
      try {
        let firstPage = true;
        const threadList: AgentSession[] = await listThreadsWithAuthRetry(
          stale,
          controller.signal,
          (sessions, more) => {
            if (stale() || !more || !firstPage) return;
            // Show the newest chats now; older pages follow.
            firstPage = false;
            applyThreads(sessions, false);
            setFirstPageOwner(owner);
          },
        );
        if (stale()) return;

        applyThreads(threadList, true);

        const currentContext = threadContextRef.current;
        const remoteThreadIds = remoteThreadIdsRef.current;
        const activeThreadId = currentContext.currentThreadId;
        let threadIdToLoad = activeThreadId;
        const activeSnapshot = sessionManager
          .get(activeThreadId)
          ?.getSnapshot();
        // A message sent here before the list arrived keeps the chat. History
        // loaded for the restored id proves nothing about ownership.
        const activeHasUserMessage =
          activeThreadId === restoredId
            ? Boolean(
                activeSnapshot &&
                (activeSnapshot.pendingUserMessage !== undefined ||
                  activeSnapshot.isSubmitting),
              )
            : Boolean(
                activeSnapshot?.messages.some(
                  (message) => message.sender === "user",
                ),
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

        // The open chat first; background history reads wait for it. Its
        // own failure is shown in the chat, not as a list failure.
        if (remoteThreadIds.has(threadIdToLoad))
          await ensureInitialState(threadIdToLoad).catch((error) =>
            console.debug("Failed to load chat:", threadIdToLoad, error),
          );
        if (stale()) return;
        scheduleThreadPrefetch(threadList.map((thread) => thread.id));
      } catch (error) {
        if (stale()) return;
        console.error("Failed to fetch thread list:", error);
        setThreadListError(true);
      } finally {
        if (!stale()) {
          setSettledOwner(owner);
          setIsThreadListLoading(false);
        }
      }
    };

    void fetchThreadList();

    return () => {
      cancelled = true;
      controller.abort();
      prefetchCancelRef.current?.();
      prefetchCancelRef.current = null;
    };
  }, [
    listMode,
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

  const revalidating =
    restoringAccount ||
    previewingAccount ||
    (canLoadThreads && (isThreadListLoading || settledOwner !== owner));
  return {
    // Access can settle in the same render that enables URL restoration.
    // Advertise loading before the request effect runs, until its first
    // result. Revalidation continues until every page has arrived.
    isThreadListLoading:
      revalidating && cachedOwner !== owner && firstPageOwner !== owner,
    isThreadListRevalidating: revalidating,
    threadListError,
    canLoadThreads,
  };
}

function isTelegramThread(thread: AgentSession): boolean {
  return (thread as AgentSession & SessionOriginFields).origin === "telegram";
}

/** Optional step 2 `origin` / `origin_app`; older servers send neither. */
function threadOrigin(
  thread: AgentSession,
): Pick<ThreadMetadata, "origin" | "originApp"> {
  const { origin, origin_app } = thread as AgentSession & SessionOriginFields;
  return {
    ...(origin ? { origin } : {}),
    ...(typeof origin_app === "number" ? { originApp: origin_app } : {}),
  };
}
