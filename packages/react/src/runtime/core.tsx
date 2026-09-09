"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";

import {
  AgentApiError,
  type ActionCapabilities,
  type AomiClient,
} from "@aomi-labs/client";
import { useControl } from "../contexts/control-context";
import { useUser } from "../contexts/ext-user-context";
import { useThreadContext } from "../contexts/thread-context";
import { useNotification } from "../contexts/notification-context";
import { useRuntimeOrchestrator } from "./orchestrator";
import { buildThreadListAdapter } from "./threadlist-adapter";
import { AomiRuntimeApiProvider, type AomiRuntimeApi } from "../interface";
import { useActions } from "../actions/use-actions";
import { useThreadListSync } from "./thread-list-sync";
import { getHttpStatus } from "./http-status";
import {
  clearPersistedThreadId,
  writePersistedThreadId,
} from "./thread-persistence";
import { projectAssistantMessages, projectRuntimeMessages } from "./utils";

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

function appendMessageText(message: AppendMessage): string {
  return message.content
    .filter(
      (part): part is Extract<typeof part, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

// =============================================================================
// Core Props
// =============================================================================

export type AomiRuntimeCoreProps = {
  children: ReactNode;
  aomiClient: AomiClient;
  applicationId?: number | string | null;
  actions?: ActionCapabilities;
  accountSessionAvailable?: boolean;
  restoredThreadId?: string;
  threadPersistenceKey?: string | null;
};

// =============================================================================
// Core Component
// =============================================================================

export function AomiRuntimeCore({
  children,
  aomiClient,
  applicationId,
  actions: actionCapabilities,
  accountSessionAvailable = false,
  restoredThreadId,
  threadPersistenceKey,
}: Readonly<AomiRuntimeCoreProps>) {
  const threadContext = useThreadContext();
  const notificationContext = useNotification();
  const { getUserState } = useUser();
  const {
    getControlState,
    getCurrentThreadControl,
    getCurrentThreadApplicationId,
    getCurrentThreadApp,
    getPreferredThreadControl,
    markControlSynced,
  } = useControl();
  const inferenceFunding = getControlState().inferenceFunding;

  // ---------------------------------------------------------------------------
  // Orchestrator (manages ClientSession per thread)
  // ---------------------------------------------------------------------------
  const {
    sessionManager,
    currentSession,
    snapshot,
    getSession,
    ensureInitialState,
    sendMessage: orchestratorSendMessage,
    cancelGeneration: orchestratorCancel,
    closeSession,
    closeAllSessions,
    aomiClientRef,
  } = useRuntimeOrchestrator(aomiClient, {
    getUserState,
    inferenceFunding,
    getApp: getCurrentThreadApp,
    getModel: () => {
      const control = getCurrentThreadControl();
      return control.modelMode === "manual" ? control.model : null;
    },
    getApplicationId: () => getCurrentThreadApplicationId() ?? applicationId,
    getClientId: () => getControlState().clientId ?? undefined,
    getActions: () => actionCapabilities,
    onSendSuccess: (threadId) => {
      const wasRemote = remoteThreadIdsRef.current.has(threadId);
      remoteThreadIdsRef.current.add(threadId);
      warmedThreadIdsRef.current.add(threadId);
      if (threadPersistenceKey) {
        writePersistedThreadId(threadPersistenceKey, threadId);
      }
      if (!wasRemote && threadContextRef.current.currentThreadId === threadId) {
        markControlSynced();
      }
    },
    onSendError: (_threadId, error) => {
      const httpStatus = getHttpStatus(error);

      if (httpStatus === 402) {
        // The `payment_required` modal (apps/shadcn-registry payment-required-gate)
        // owns its own copy; only `kind` is consumed for routing. `message`
        // would be dead config — leave it off so there's one source of truth.
        notificationContext.showNotification({
          type: "error",
          kind: "payment_required",
          title: "You're out of funds",
        });
        // Prewarmed empty threads are intentionally durable. A quota failure
        // keeps the same thread so payment setup can retry without another
        // create/model round trip.
        return;
      }

      if (
        error instanceof AgentApiError &&
        error.code === "session_not_found"
      ) {
        // The pinned thread belongs to another principal (sign-out, new
        // guest). Drop the pin so the next attempt starts clean instead of
        // 404ing forever.
        if (threadPersistenceKey) {
          clearPersistedThreadId(threadPersistenceKey);
        }
        notificationContext.showNotification({
          type: "error",
          title: "Conversation unavailable",
          message:
            "This conversation is no longer accessible. Start a new chat and send your message again.",
        });
        return;
      }

      // Every other failure was previously swallowed — the composer text
      // vanished with no feedback at all.
      notificationContext.showNotification({
        type: "error",
        title: "Message not sent",
        message:
          error instanceof Error && error.message
            ? error.message
            : "Something went wrong sending your message. Please try again.",
      });
    },
  });

  const actions = useActions(currentSession);
  const isRunning =
    snapshot.isSubmitting || snapshot.turnState === "processing";

  // ---------------------------------------------------------------------------
  // Refs for stable access
  // ---------------------------------------------------------------------------
  const threadContextRef = useRef(threadContext);
  threadContextRef.current = threadContext;
  const remoteThreadIdsRef = useRef(new Set<string>());
  const warmedThreadIdsRef = useRef(new Set<string>());
  const warmPromisesRef = useRef(new Map<string, Promise<void>>());
  const [isThreadLoading, setIsThreadLoading] = useState(false);

  const warmThread = useCallback(async (threadId: string) => {
    if (
      !remoteThreadIdsRef.current.has(threadId) ||
      warmedThreadIdsRef.current.has(threadId)
    ) {
      return;
    }

    warmedThreadIdsRef.current.add(threadId);
  }, []);

  const getRuntimeSession = useCallback(
    (threadId: string) => sessionManager.get(threadId) ?? getSession(threadId),
    [getSession, sessionManager],
  );

  const threadPersistence = useMemo(
    () => ({
      restoredThreadId,
      onInvalidRestoredThread: () => {
        if (threadPersistenceKey) {
          clearPersistedThreadId(threadPersistenceKey);
        }
      },
    }),
    [restoredThreadId, threadPersistenceKey],
  );

  const { isThreadListLoading, threadListError } = useThreadListSync({
    sessions: {
      aomiClientRef,
      sessionManager,
      closeAllSessions,
      ensureInitialState,
      setIsThreadLoading,
    },
    remoteThreads: {
      remoteThreadIdsRef,
      warmPromisesRef,
      warmedThreadIdsRef,
      warmThread,
    },
    accountSessionAvailable,
    threadPersistence,
  });
  // ---------------------------------------------------------------------------
  // Initial state fetch on thread change (skip for local-only threads)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const threadId = threadContext.currentThreadId;
    if (!remoteThreadIdsRef.current.has(threadId)) {
      setIsThreadLoading(false);
      return;
    }

    let cancelled = false;
    setIsThreadLoading(true);

    void (async () => {
      try {
        await warmThread(threadId);
        if (!cancelled) {
          await ensureInitialState(threadId);
        }
      } finally {
        if (!cancelled) {
          setIsThreadLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ensureInitialState, threadContext.currentThreadId, warmThread]);

  // The server's user event can trail the start response by a poll or two.
  // Echo it immediately with the same ordinal id the canonical projection will
  // use, keeping the previous assistant reply complete without creating a
  // phantom user-message branch when the server event arrives.
  const currentMessages = useMemo(
    () => projectRuntimeMessages(snapshot.events, snapshot.pendingUserMessage),
    [snapshot.events, snapshot.pendingUserMessage],
  );

  useEffect(() => {
    if (!threadPersistenceKey) return;
    const threadId = threadContext.currentThreadId;
    if (!remoteThreadIdsRef.current.has(threadId)) {
      return;
    }
    writePersistedThreadId(threadPersistenceKey, threadId);
  }, [
    threadContext.allThreadsMetadata,
    threadContext.currentThreadId,
    threadPersistenceKey,
  ]);

  // ---------------------------------------------------------------------------
  // Thread list adapter
  // ---------------------------------------------------------------------------
  const threadListAdapter = useMemo(
    () =>
      buildThreadListAdapter({
        aomiClientRef,
        threadContext,
        isLoading: isThreadListLoading,
        getInitialControl: getPreferredThreadControl,
        isRemoteThread: (threadId) => remoteThreadIdsRef.current.has(threadId),
      }),
    [
      aomiClientRef,
      getPreferredThreadControl,
      isThreadListLoading,
      threadContext,
      threadContext.currentThreadId,
      threadContext.allThreadsMetadata,
      currentMessages,
    ],
  );

  // ---------------------------------------------------------------------------
  // External store runtime
  // ---------------------------------------------------------------------------
  const restoreComposerTextRef = useRef<(text: string) => void>(() => {});
  const runtime = useExternalStoreRuntime({
    messages: currentMessages,
    isLoading: isThreadLoading,
    isRunning,
    onNew: async (message: AppendMessage) => {
      const text = appendMessageText(message);
      if (text) {
        try {
          await orchestratorSendMessage(text, threadContext.currentThreadId);
        } catch (error) {
          console.error("Failed to send message:", error);
          restoreComposerTextRef.current(text);
        }
      }
    },
    onCancel: async () => {
      await orchestratorCancel(threadContext.currentThreadId);
    },
    convertMessage: (msg) => msg,
    adapters: { threadList: threadListAdapter },
  });
  restoreComposerTextRef.current = (text) => {
    const composer = runtime.thread.composer;
    if (!composer.getState().text) composer.setText(text);
  };

  // ---------------------------------------------------------------------------
  // Cleanup on unmount.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      warmPromisesRef.current.clear();
      closeAllSessions();
    };
  }, [closeAllSessions]);

  // ---------------------------------------------------------------------------
  // Build AomiRuntimeApi
  // ---------------------------------------------------------------------------
  const userContext = useUser();

  const sendMessage = useCallback(
    async (text: string) => {
      await orchestratorSendMessage(text, threadContext.currentThreadId);
    },
    [orchestratorSendMessage, threadContext.currentThreadId],
  );

  const cancelGeneration = useCallback(() => {
    void orchestratorCancel(threadContext.currentThreadId);
  }, [orchestratorCancel, threadContext.currentThreadId]);

  const getMessages = useCallback(
    (threadId?: string) => {
      const id = threadId ?? threadContext.currentThreadId;
      const session = sessionManager.get(id);
      if (!session) return [];
      return projectAssistantMessages(session.getSnapshot().events);
    },
    [threadContext],
  );

  const createThread = useCallback(async (): Promise<string> => {
    await threadListAdapter.onSwitchToNewThread();
    return threadContextRef.current.currentThreadId;
  }, [threadListAdapter]);

  const deleteThread = useCallback(
    async (threadId: string) => {
      closeSession(threadId);
      await threadListAdapter.onDelete(threadId);
      remoteThreadIdsRef.current.delete(threadId);
      warmedThreadIdsRef.current.delete(threadId);
      warmPromisesRef.current.delete(threadId);

      const nextThreadId = threadContextRef.current.currentThreadId;
      if (
        !remoteThreadIdsRef.current.has(nextThreadId) &&
        threadPersistenceKey
      ) {
        clearPersistedThreadId(threadPersistenceKey);
      }
    },
    [closeSession, threadListAdapter, threadPersistenceKey],
  );

  const selectThread = useCallback(
    (threadId: string) => {
      if (threadContext.allThreadsMetadata.has(threadId)) {
        threadListAdapter.onSwitchToThread(threadId);
      } else {
        void threadListAdapter.onSwitchToNewThread();
      }
    },
    [threadContext.allThreadsMetadata, threadListAdapter],
  );

  const simulateBatchTransactions = useCallback<
    AomiRuntimeApi["simulateBatchTransactions"]
  >(
    async (transactions, options) => {
      const session = getRuntimeSession(threadContext.currentThreadId);
      if (!session) {
        throw new Error("runtime_session_unavailable");
      }

      const response = await session.client.simulateBatch(
        session.sessionId,
        transactions,
        options,
      );
      return response.result;
    },
    [getRuntimeSession, threadContext.currentThreadId],
  );

  const aomiRuntimeApi: AomiRuntimeApi = useMemo(
    () => ({
      account: aomiClient.account,
      // User API
      user: userContext.user,
      getUserState: userContext.getUserState,
      setUser: userContext.setUser,
      addExtValue: userContext.addExtValue,
      removeExtValue: userContext.removeExtValue,

      // Thread API
      currentThreadId: threadContext.currentThreadId,
      threadViewKey: threadContext.threadViewKey,
      threadMetadata: threadContext.allThreadsMetadata,
      threadListError,
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
      threadContext.currentThreadId,
      threadContext.threadViewKey,
      threadContext.allThreadsMetadata,
      threadContext.getThreadMetadata,
      threadListError,
      createThread,
      deleteThread,
      threadListAdapter,
      selectThread,
      isRunning,
      snapshot.isSubmitting,
      getMessages,
      sendMessage,
      cancelGeneration,
      notificationContext,
      actions,
      simulateBatchTransactions,
      snapshot.events,
      snapshot.turnState,
    ],
  );

  return (
    <AomiRuntimeApiProvider value={aomiRuntimeApi}>
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </AomiRuntimeApiProvider>
  );
}
