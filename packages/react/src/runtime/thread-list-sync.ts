"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type {
  AgentSession,
  AomiClient,
  UserState,
} from "@aomi-labs/client";
import { UserState as UserStateHelpers } from "@aomi-labs/client";

import { useControl, type ControlState } from "../contexts/control-context";
import { useNotification } from "../contexts/notification-context";
import type { ThreadContext } from "../contexts/thread-context";
import { useThreadContext } from "../contexts/thread-context";
import { useUser } from "../contexts/ext-user-context";
import { initThreadControl, type ThreadMetadata } from "../state/thread-store";
import { getControlSessionId } from "../utils/client-session";
import { isPlaceholderTitle } from "./utils";
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

type RuntimeSessionBridge = {
  aomiClientRef: MutableRefObject<AomiClient>;
  sessionManager: SessionManager;
  closeAllSessions: () => void;
  ensureInitialState: (threadId: string) => Promise<void>;
  setIsThreadLoading: (loading: boolean) => void;
};

type RemoteThreadRegistry = {
  remoteThreadIdsRef: MutableRefObject<Set<string>>;
  warmPromisesRef: MutableRefObject<Map<string, Promise<void>>>;
  warmedThreadIdsRef: MutableRefObject<Set<string>>;
  warmThread: (threadId: string) => Promise<void>;
};

type ThreadListSyncOptions = {
  sessions: RuntimeSessionBridge;
  remoteThreads: RemoteThreadRegistry;
  accountSessionAvailable?: boolean;
  threadPersistence?: {
    restoredThreadId?: string;
    onInvalidRestoredThread?: () => void;
  };
};

type ThreadListContext = {
  getControlState: () => ControlState;
  threadContextRef: MutableRefObject<ThreadContext>;
  user: UserState;
};

function stableStateString(state: UserState): string {
  return JSON.stringify(state ?? {});
}

function useWalletStateNotifications(user: UserState) {
  const { showNotification } = useNotification();
  const walletSnapshot = useCallback(
    (nextUser: UserState) => ({
      connection: {
        // Serialize exactly the backend ProviderState. FE-local and account
        // identity fields are deliberately not forwarded here.
        is_connected: UserStateHelpers.isConnected(nextUser) ?? false,
        provider: UserStateHelpers.provider(nextUser) ?? undefined,
        provider_label:
          typeof nextUser.connection?.provider_label === "string"
            ? nextUser.connection.provider_label
            : undefined,
        auth_method: UserStateHelpers.authMethod(nextUser) ?? undefined,
      },
      evm: {
        address: UserStateHelpers.address(nextUser),
        chain_id: UserStateHelpers.chainId(nextUser),
        ens_name:
          typeof nextUser.evm?.ens_name === "string"
            ? nextUser.evm.ens_name
            : undefined,
      },
      svm: {
        address: UserStateHelpers.svmAddress(nextUser),
        cluster: nextUser.svm?.cluster,
        wallet_name: nextUser.svm?.wallet_name,
        transport: nextUser.svm?.transport,
        capabilities: nextUser.svm?.capabilities,
      },
    }),
    [],
  );

  const lastWalletStateRef = useRef(walletSnapshot(user));

  useEffect(() => {
    const nextWalletState = walletSnapshot(user);
    const prevWalletState = lastWalletStateRef.current;
    if (
      stableStateString(prevWalletState as UserState) ===
      stableStateString(nextWalletState as UserState)
    ) {
      return;
    }
    lastWalletStateRef.current = nextWalletState;
    const wasConnected = prevWalletState.connection.is_connected;
    const isConnected = nextWalletState.connection.is_connected;
    if (wasConnected !== isConnected) {
      showNotification({
        type: "wallet",
        title: isConnected ? "Wallet connected" : "Wallet disconnected",
      });
    }
  }, [showNotification, user, walletSnapshot]);
}

function useRemoteThreadListSync(
  context: ThreadListContext,
  sessions: RuntimeSessionBridge,
  remoteThreads: RemoteThreadRegistry,
  accountSessionAvailable: boolean,
  threadPersistence?: ThreadListSyncOptions["threadPersistence"],
): { isThreadListLoading: boolean; threadListError: boolean } {
  const [isThreadListLoading, setIsThreadListLoading] = useState(true);
  const [threadListError, setThreadListError] = useState(false);
  const prefetchCancelRef = useRef<(() => void) | null>(null);
  const hadThreadAccessRef = useRef(false);
  const { getControlState, threadContextRef, user } = context;
  const {
    aomiClientRef,
    closeAllSessions,
    ensureInitialState,
    sessionManager,
    setIsThreadLoading,
  } = sessions;
  const {
    remoteThreadIdsRef,
    warmPromisesRef,
    warmedThreadIdsRef,
    warmThread,
  } = remoteThreads;
  const isConnected = UserStateHelpers.isConnected(user) === true;
  const canLoadThreads = isConnected || accountSessionAvailable;
  const restoredThreadId = threadPersistence?.restoredThreadId;

  const listThreadsWithAuthRetry = useCallback(
    async (_sessionId: string, isCancelled: () => boolean) => {
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
            if (
              sessionManager.get(threadId)?.getSnapshot().messages.length
            ) {
              return;
            }

            try {
              await warmThread(threadId);
              if (cancelled || !remoteThreadIdsRef.current.has(threadId)) {
                return;
              }
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
    [ensureInitialState, remoteThreadIdsRef, sessionManager, warmThread],
  );

  useEffect(() => {
    if (!canLoadThreads) {
      const previouslyHadThreadAccess = hadThreadAccessRef.current;
      hadThreadAccessRef.current = false;
      setIsThreadListLoading(false);
      prefetchCancelRef.current?.();
      prefetchCancelRef.current = null;

      if (previouslyHadThreadAccess) {
        const hadRemoteThreads = remoteThreadIdsRef.current.size > 0;
        const hadSessions = sessionManager.size > 0;
        remoteThreadIdsRef.current.clear();
        warmedThreadIdsRef.current.clear();
        warmPromisesRef.current.clear();
        closeAllSessions();
        if (hadRemoteThreads || hadSessions) {
          threadContextRef.current.resetToDefault();
          threadPersistence?.onInvalidRestoredThread?.();
        }
      }
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
        const controlSessionId = getControlSessionId(
          getControlState().clientId,
          currentContext.currentThreadId,
        );
        const threadList: AgentSession[] = await listThreadsWithAuthRetry(
          controlSessionId,
          () => cancelled,
        );
        if (cancelled) return;

        const remoteThreadIds = new Set<string>();
        const previousMetadata = currentContext.allThreadsMetadata;
        const newMetadata = new Map<string, ThreadMetadata>();
        const baseThreadCount = currentContext.threadCnt;
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
            control: existingControl ?? initThreadControl(),
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
        warmedThreadIdsRef.current = new Set(
          Array.from(warmedThreadIdsRef.current).filter((threadId) =>
            remoteThreadIds.has(threadId),
          ),
        );
        currentContext.setThreadMetadata(newMetadata);
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
          threadPersistence?.onInvalidRestoredThread?.();
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

        if (remoteThreadIds.has(threadIdToLoad)) {
          setIsThreadLoading(true);
          try {
            await warmThread(threadIdToLoad);
            if (!cancelled) {
              await ensureInitialState(threadIdToLoad);
            }
          } finally {
            if (!cancelled) {
              setIsThreadLoading(false);
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch thread list:", error);
        if (!cancelled) {
          setThreadListError(true);
        }
      } finally {
        if (!cancelled) {
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
    closeAllSessions,
    ensureInitialState,
    getControlState,
    listThreadsWithAuthRetry,
    remoteThreadIdsRef,
    scheduleThreadPrefetch,
    sessionManager,
    setIsThreadLoading,
    threadContextRef,
    restoredThreadId,
    threadPersistence,
    warmPromisesRef,
    warmedThreadIdsRef,
    warmThread,
  ]);

  return { isThreadListLoading, threadListError };
}

export function useThreadListSync({
  sessions: {
    aomiClientRef,
    sessionManager,
    closeAllSessions,
    ensureInitialState,
    setIsThreadLoading,
  },
  remoteThreads,
  accountSessionAvailable = false,
  threadPersistence,
}: ThreadListSyncOptions): {
  isThreadListLoading: boolean;
  threadListError: boolean;
} {
  const threadContext = useThreadContext();
  const { user } = useUser();
  const { getControlState } = useControl();
  const threadContextRef = useRef(threadContext);
  threadContextRef.current = threadContext;

  const context: ThreadListContext = {
    getControlState,
    threadContextRef,
    user,
  };
  const sessions: RuntimeSessionBridge = {
    aomiClientRef,
    sessionManager,
    closeAllSessions,
    ensureInitialState,
    setIsThreadLoading,
  };

  useWalletStateNotifications(user);
  return useRemoteThreadListSync(
    context,
    sessions,
    remoteThreads,
    accountSessionAvailable,
    threadPersistence,
  );
}
