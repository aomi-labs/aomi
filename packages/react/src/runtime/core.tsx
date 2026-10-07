"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import type {
  ExternalStoreAdapter,
  ThreadMessageLike,
} from "@assistant-ui/react";

import type {
  ActionCapabilities,
  CommitCapabilities,
  AgentTarget,
  AomiClient,
  AomiClientOptions,
} from "@aomi-labs/client";
import { useControl } from "../contexts/control-context";
import { useUser } from "../contexts/ext-user-context";
import { useThreadContext } from "../contexts/thread-context";
import { useNotification } from "../contexts/notification-context";
import { useRuntimeOrchestrator } from "./orchestrator";
import { buildThreadListAdapter } from "./threadlist-adapter";
import { AomiRuntimeApiProvider, type AomiRuntimeApi } from "../interface";
import {
  displayKeyPrefix,
  useAomiDisplayCache,
  type RuntimeAccount,
} from "../query/display-cache";
import { useActions } from "../actions/use-actions";
import { useThreadListSync } from "./thread-list-sync";
import {
  clearPersistedThreadId,
  writePersistedThreadId,
} from "./thread-persistence";
import {
  logicalTurnRunning,
  projectAssistantMessages,
  projectRuntimeMessages,
} from "./message-projection";
import { messageActions } from "./message-actions";
import { createChatViewStore } from "../state/chat-view-store";
import {
  AssistantRuntimeBoundary,
  ChatBoundaryContext,
  type ChatBoundaryValue,
} from "./assistant-runtime-boundary";
import { describeSendFailure } from "./send-error-notices";
import { accountChange, type RuntimeOwner } from "./account-change";
import {
  hasConversation,
  isSending,
  isStreamingTextOnly,
  isTurnStopped,
} from "./turn-state";

// Native conversion caches are scoped to the chat runtime. A new converter
// identity clears them, including when only shell metadata has changed.
const identityMessage = (message: ThreadMessageLike) => message;
const NO_MESSAGES: ThreadMessageLike[] = [];

/** Deduplicate in-flight async work keyed by thread id. */
async function runSingleFlight(
  flights: Map<string, Promise<void>>,
  threadId: string,
  work: () => Promise<void>,
): Promise<void> {
  const existing = flights.get(threadId);
  if (existing) return existing;

  const promise = work();
  flights.set(threadId, promise);
  try {
    await promise;
  } finally {
    if (flights.get(threadId) === promise) {
      flights.delete(threadId);
    }
  }
}

export type AomiRuntimeCoreProps = {
  children: ReactNode;
  aomiClient: AomiClient;
  account?: RuntimeAccount | null;
  accountAuthSource?:
    | AomiClientOptions["getAccountBearer"]
    | AomiClientOptions["oauth"];
  agentTarget?: AgentTarget;
  actions?: ActionCapabilities;
  commits?: CommitCapabilities;
  accountSessionAvailable?: boolean;
  restoredThreadId?: string;
  threadPersistenceKey?: string | null;
};

export function AomiRuntimeCore({
  children,
  aomiClient,
  account,
  accountAuthSource,
  agentTarget,
  actions: actionCapabilities,
  commits: commitCapabilities,
  accountSessionAvailable = false,
  restoredThreadId,
  threadPersistenceKey,
}: Readonly<AomiRuntimeCoreProps>) {
  const threadContext = useThreadContext();
  const threadContextRef = useRef(threadContext);
  threadContextRef.current = threadContext;
  const [chatView] = useState(() => createChatViewStore());
  const chatGeneration = useSyncExternalStore(
    chatView.subscribe,
    chatView.version,
    chatView.version,
  );
  const readComposerTextRef = useRef<() => string>(() => "");
  const restoreComposerTextRef = useRef<(text: string) => void>(() => {});
  const notificationContext = useNotification();
  const userContext = useUser();
  const {
    getControlState,
    getCurrentThreadControl,
    getCurrentThreadTarget,
    getPreferredThreadControl,
    markControlSynced,
  } = useControl();
  const displayCache = useAomiDisplayCache();
  const displayCacheRef = useRef(displayCache);
  displayCacheRef.current = displayCache;
  // Chats the backend knows about; the rest exist only in this tab so far.
  const remoteThreadIdsRef = useRef(new Set<string>());
  const cancelPromisesRef = useRef(new Map<string, Promise<void>>());

  const forgetPersistedThread = useCallback(() => {
    if (threadPersistenceKey) clearPersistedThreadId(threadPersistenceKey);
  }, [threadPersistenceKey]);
  /** Drop what this tab remembers about the chats that were just closed. */
  const forgetConversations = useCallback(() => {
    remoteThreadIdsRef.current.clear();
    chatView.clear();
    forgetPersistedThread();
  }, [chatView, forgetPersistedThread]);

  const {
    sessionManager,
    currentSession,
    snapshot,
    getSession,
    ensureInitialState,
    isLoading,
    sendMessage: orchestratorSendMessage,
    cancelGeneration: orchestratorCancel,
    closeSession,
    closeAllSessions,
    aomiClientRef,
  } = useRuntimeOrchestrator(aomiClient, {
    getUserState: userContext.getUserState,
    inferenceFunding: getControlState().inferenceFunding,
    getTarget: () => agentTarget ?? getCurrentThreadTarget(),
    getModel: () => {
      const control = getCurrentThreadControl();
      return control.modelMode === "manual" ? control.model : null;
    },
    getClientId: () => getControlState().clientId ?? undefined,
    getActions: () => actionCapabilities,
    getCommits: () => commitCapabilities,
    onGuestExpired: forgetConversations,
    onTurnEnded: () => {
      const cache = displayCacheRef.current;
      if (cache?.scope.account?.kind === "user")
        void cache.client.invalidateQueries({
          queryKey: cache.key("credits"),
          exact: true,
        });
    },
    onSendSuccess: (threadId) => {
      const wasRemote = remoteThreadIdsRef.current.has(threadId);
      remoteThreadIdsRef.current.add(threadId);
      if (threadPersistenceKey)
        writePersistedThreadId(threadPersistenceKey, threadId);
      if (!wasRemote && threadContextRef.current.currentThreadId === threadId)
        markControlSynced();
    },
    onSendError: (threadId, error) => {
      const failure = describeSendFailure(
        error,
        Boolean(sessionManager.get(threadId)?.getSnapshot().isStartUncertain),
      );
      if (failure.forgetThread) forgetPersistedThread();
      notificationContext.showNotification(failure.notice);
    },
  });

  const actions = useActions(currentSession);

  /**
   * Close every chat and forget it. With `carryDraft`, the unsent composer
   * text moves along, and an empty chat keeps its id.
   */
  const resetConversation = useCallback(
    (carryDraft = false) => {
      const threads = threadContextRef.current;
      const currentId = threads.currentThreadId;
      const draft = carryDraft
        ? {
            draft: readComposerTextRef.current(),
            mentions: chatView.get(currentId)?.mentions,
          }
        : undefined;
      const started = hasConversation(
        sessionManager.get(currentId)?.getSnapshot(),
      );
      closeAllSessions();
      forgetConversations();
      const nextId = draft && !started ? currentId : threads.resetToDefault();
      if (draft) chatView.patch(nextId, draft);
    },
    [chatView, closeAllSessions, forgetConversations, sessionManager],
  );

  const scope = displayCache?.scope;
  const owner: RuntimeOwner = {
    backendUrl: scope?.backendUrl ?? "",
    appId: scope?.appId ?? "",
    account,
    authSource: accountAuthSource,
  };
  const previousOwner = useRef(owner);
  useLayoutEffect(() => {
    const change = accountChange(previousOwner.current, owner);
    previousOwner.current = owner;
    if (change !== "keep") resetConversation(change === "sign-in");
  });

  const userId = account?.kind === "user" ? account.id : null;
  // Bumped when the account's data changed under the same id (a merge).
  const [accountRevision, setAccountRevision] = useState(0);
  const listOwner = useMemo(
    () => ({
      backendUrl: owner.backendUrl,
      appId: owner.appId,
      userId,
      accountRevision,
    }),
    [owner.backendUrl, owner.appId, userId, accountRevision],
  );
  const refreshAccountData = useCallback(() => {
    const cache = displayCacheRef.current;
    if (cache?.scope.account)
      void cache.client.invalidateQueries({
        queryKey: displayKeyPrefix(cache.scope, cache.scope.account),
      });
    setAccountRevision((revision) => revision + 1);
  }, []);
  const { isThreadListLoading, threadListError } = useThreadListSync({
    aomiClientRef,
    sessionManager,
    ensureInitialState,
    resetConversation,
    remoteThreadIdsRef,
    accountSessionAvailable,
    owner: listOwner,
    restoredThreadId,
    onInvalidRestoredThread: forgetPersistedThread,
  });

  const currentThreadId = threadContext.currentThreadId;
  const isThreadLoading =
    remoteThreadIdsRef.current.has(currentThreadId) &&
    isLoading(currentThreadId);
  useEffect(() => {
    if (!remoteThreadIdsRef.current.has(currentThreadId)) return;
    ensureInitialState(currentThreadId).catch((error) =>
      console.debug("Failed to load chat:", currentThreadId, error),
    );
  }, [ensureInitialState, currentThreadId]);

  // The server's user event can trail the start response by a poll or two.
  // Echo it immediately with the same ordinal id the server's own event will
  // get, so the previous reply stays complete and no phantom branch appears.
  const messages = useMemo(
    () =>
      projectRuntimeMessages(
        snapshot.events,
        snapshot.pendingUserMessage,
        snapshot.liveMessages,
        snapshot.stoppedTurnId,
        snapshot.terminalTurns,
        snapshot.pendingReplacesMessageKey,
      ),
    [
      snapshot.events,
      snapshot.pendingUserMessage,
      snapshot.liveMessages,
      snapshot.stoppedTurnId,
      snapshot.terminalTurns,
      snapshot.pendingReplacesMessageKey,
    ],
  );
  const isRunning =
    isSending(snapshot) ||
    (!isTurnStopped(snapshot) &&
      !snapshot.terminalTurns?.some(
        (turn) => turn.turnId === snapshot.turnId,
      ) &&
      logicalTurnRunning(
        snapshot.events,
        messages,
        snapshot.turnState,
        snapshot.isSubmitting,
        snapshot.pendingUserMessage,
      ));

  useEffect(() => {
    if (!threadPersistenceKey) return;
    if (!remoteThreadIdsRef.current.has(currentThreadId)) return;
    writePersistedThreadId(threadPersistenceKey, currentThreadId);
  }, [threadContext.allThreadsMetadata, currentThreadId, threadPersistenceKey]);

  const threadListAdapter = useMemo(
    () =>
      buildThreadListAdapter({
        aomiClientRef,
        threadContext,
        isLoading: isThreadListLoading,
        getInitialControl: getPreferredThreadControl,
        isRemoteThread: (threadId) =>
          remoteThreadIdsRef.current.has(threadId) ||
          Boolean(threadContext.getThreadMetadata(threadId)?.pending) ||
          Boolean(sessionManager.get(threadId)?.getSnapshot().turnId),
      }),
    [
      aomiClientRef,
      getPreferredThreadControl,
      isThreadListLoading,
      threadContext,
      sessionManager,
    ],
  );

  const cancelThreadGeneration = useCallback(
    (threadId: string) =>
      runSingleFlight(cancelPromisesRef.current, threadId, async () => {
        try {
          await orchestratorCancel(threadId);
        } catch (error) {
          const current = sessionManager.get(threadId)?.getSnapshot();
          const retryable =
            current?.isStartUncertain ||
            current?.turnState === "processing" ||
            current?.turnState === "awaiting_action";
          notificationContext.showNotification({
            type: "error",
            title: "Unable to stop generation",
            message: `${error instanceof Error ? error.message : "The Stop request failed"}. ${retryable ? "Generation may still be running. Try Stop again." : "Refresh the conversation to check its status."}`,
          });
        }
      }),
    [orchestratorCancel, notificationContext, sessionManager],
  );
  const assistantAdapter: ExternalStoreAdapter<ThreadMessageLike> = {
    messages,
    isLoading: isThreadLoading,
    isRunning,
    ...messageActions({
      messages,
      send: (text, options) =>
        orchestratorSendMessage(text, currentThreadId, options),
      restore: (text) => {
        // The chats this failure belongs to were closed since.
        if (chatView.version() !== chatGeneration) return;
        // A late failure belongs to the originating chat, not the newly selected composer.
        if (threadContextRef.current.currentThreadId === currentThreadId)
          restoreComposerTextRef.current(text);
        else chatView.patch(currentThreadId, { draft: text });
      },
      unavailable: (message) =>
        notificationContext.showNotification({
          type: "error",
          title: "Message action unavailable",
          message,
        }),
    }),
    onCancel: async () => {
      await cancelThreadGeneration(currentThreadId);
    },
    convertMessage: identityMessage,
    adapters: { threadList: threadListAdapter },
  };

  useEffect(() => () => chatView.clear(), [chatView]);

  const sendMessage = useCallback(
    async (text: string) => {
      await orchestratorSendMessage(text, currentThreadId);
    },
    [orchestratorSendMessage, currentThreadId],
  );

  const cancelGeneration = useCallback(() => {
    void cancelThreadGeneration(currentThreadId);
  }, [cancelThreadGeneration, currentThreadId]);

  const getMessages = useCallback(
    (threadId?: string) => {
      const session = sessionManager.get(threadId ?? currentThreadId);
      return session
        ? projectAssistantMessages(session.getSnapshot().events)
        : [];
    },
    [currentThreadId, sessionManager],
  );

  const createThread = useCallback(async (): Promise<string> => {
    await threadListAdapter.onSwitchToNewThread();
    return threadContextRef.current.currentThreadId;
  }, [threadListAdapter]);

  const deleteThread = useCallback(
    async (threadId: string) => {
      closeSession(threadId);
      await threadListAdapter.onDelete(threadId);
      chatView.delete(threadId);
      remoteThreadIdsRef.current.delete(threadId);
      const nextThreadId = threadContextRef.current.currentThreadId;
      if (!remoteThreadIdsRef.current.has(nextThreadId))
        forgetPersistedThread();
    },
    [chatView, closeSession, forgetPersistedThread, threadListAdapter],
  );

  const selectThread = useCallback(
    (threadId: string) => {
      if (threadContextRef.current.getThreadMetadata(threadId)) {
        threadListAdapter.onSwitchToThread(threadId);
      } else {
        void threadListAdapter.onSwitchToNewThread();
      }
    },
    [threadListAdapter],
  );

  const simulateBatchTransactions = useCallback<
    AomiRuntimeApi["simulateBatchTransactions"]
  >(
    async (transactions, options) => {
      const session =
        sessionManager.get(currentThreadId) ?? getSession(currentThreadId);
      const response = await session.client.simulateBatch(
        session.sessionId,
        transactions,
        options,
      );
      return response.result;
    },
    [getSession, sessionManager, currentThreadId],
  );

  const aomiRuntimeApi: AomiRuntimeApi = useMemo(
    () => ({
      account: aomiClient.account,
      transactionSafety: aomiClient.transactionSafety,
      refreshAccountData,
      // User API
      user: userContext.user,
      getUserState: userContext.getUserState,
      setUser: userContext.setUser,
      addExtValue: userContext.addExtValue,
      removeExtValue: userContext.removeExtValue,

      // Thread API
      currentThreadId,
      threadViewKey: threadContext.threadViewKey,
      threadMetadata: threadContext.allThreadsMetadata,
      threadListError,
      threadListLoading: isThreadListLoading,
      isRemoteThread: (threadId) =>
        remoteThreadIdsRef.current.has(threadId) ||
        Boolean(sessionManager.get(threadId)?.getSnapshot().turnId),
      getThreadMetadata: threadContext.getThreadMetadata,
      createThread,
      deleteThread,
      renameThread: (threadId, title) =>
        threadListAdapter.onRename(threadId, title),
      archiveThread: (threadId) => threadListAdapter.onArchive(threadId),
      selectThread,

      // Chat API
      isRunning,
      isSubmitting: snapshot.isSubmitting,
      isStopping: snapshot.isStopping ?? false,
      getMessages,
      sendMessage,
      cancelGeneration,

      // Notification API
      notifications: notificationContext.notifications,
      showNotification: notificationContext.showNotification,
      dismissNotification: notificationContext.dismissNotification,
      clearAllNotifications: notificationContext.clearAll,

      // Action API
      pendingActions: actions.pendingActions,
      commits: snapshot.commits,
      commitController: currentSession?.commits,
      actionAttempts: actions.actionAttempts,
      hasBlockingActions: actions.hasBlockingActions,
      executeAction: actions.executeAction,
      respondToAction: actions.respondToAction,
      rejectAction: actions.rejectAction,
      simulateBatchTransactions,

      events: snapshot.events,
      turnState: snapshot.turnState,
    }),
    [
      userContext,
      aomiClient.account,
      aomiClient.transactionSafety,
      refreshAccountData,
      currentThreadId,
      threadContext.threadViewKey,
      threadContext.allThreadsMetadata,
      threadContext.getThreadMetadata,
      threadListError,
      createThread,
      isThreadListLoading,
      sessionManager,
      deleteThread,
      threadListAdapter,
      selectThread,
      isRunning,
      snapshot.isSubmitting,
      snapshot.isStopping,
      getMessages,
      sendMessage,
      cancelGeneration,
      notificationContext,
      actions,
      currentSession,
      simulateBatchTransactions,
      snapshot.events,
      snapshot.commits,
      snapshot.turnState,
    ],
  );

  // Hosts that never render AomiChatBoundary get the chat in the shell's
  // runtime, replaced on each chat switch so message indices stay in step.
  const [boundaryRendered, setBoundaryRendered] = useState(false);
  const onBoundaryMount = useCallback(() => setBoundaryRendered(true), []);
  const firstThreadId = useRef(currentThreadId).current;
  const chat: ChatBoundaryValue = {
    threadId: currentThreadId,
    adapter: assistantAdapter,
    restoreComposerText: restoreComposerTextRef,
    readComposerText: readComposerTextRef,
    store: chatView,
    generation: chatGeneration,
    deferMessages: isStreamingTextOnly(snapshot),
    onBoundaryMount,
  };
  return (
    <AomiRuntimeApiProvider value={aomiRuntimeApi}>
      <AssistantRuntimeBoundary
        key={
          boundaryRendered || currentThreadId === firstThreadId
            ? "shell"
            : currentThreadId
        }
        adapter={
          boundaryRendered
            ? {
                ...assistantAdapter,
                messages: NO_MESSAGES,
                isRunning: false,
                isLoading: false,
              }
            : assistantAdapter
        }
        restoreComposerText={
          boundaryRendered ? undefined : restoreComposerTextRef
        }
        readComposerText={boundaryRendered ? undefined : readComposerTextRef}
      >
        <ChatBoundaryContext.Provider value={chat}>
          {children}
        </ChatBoundaryContext.Provider>
      </AssistantRuntimeBoundary>
    </AomiRuntimeApiProvider>
  );
}
