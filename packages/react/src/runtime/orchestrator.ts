"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
} from "react";

import {
  AgentApiError,
  CLIENT_TYPE_WEB_UI,
  Session as ClientSession,
  UserState as UserStateValue,
  type ActionCapabilities,
  type CommitCapabilities,
  type AgentTarget,
  type AomiClient,
  type SendOptions,
  type SessionSnapshot,
  type UserState,
} from "@aomi-labs/client";
import type { AomiInferenceFundingSource } from "../interface";
import { useThreadContext } from "../contexts/thread-context";
import { SessionManager } from "./session-manager";
import {
  isPlaceholderTitle,
  reconcileGeneratedThreadTitle,
} from "./thread-title";
import { stripCapabilityHints } from "./capability-hints";
import { isSending, isTurnActive, isTurnOver } from "./turn-state";

type OrchestratorOptions = {
  getUserState: () => UserState;
  getTarget: () => AgentTarget;
  getModel?: () => string | null | undefined;
  getClientId?: () => string | undefined;
  inferenceFunding?: AomiInferenceFundingSource;
  getActions?: () => ActionCapabilities | undefined;
  getCommits?: () => CommitCapabilities | undefined;
  onSendSuccess?: (threadId: string) => void;
  /** A turn this runtime watched has finished, failed or been stopped. */
  onTurnEnded?: (threadId: string) => void;
  /** All chats were closed because the guest behind them expired. */
  onGuestExpired?: () => void;
  onSendError?: (threadId: string, error: unknown) => Promise<void> | void;
};

/**
 * Calls `onEnded` once each time a turn this session started or saw running
 * reaches its end. The turn shown before a send is not the one being waited
 * for, so a send that never starts reports nothing.
 */
function watchTurnEnds(onEnded: (snapshot: SessionSnapshot) => void) {
  let waiting: { previousTurn?: string } | null = null;
  return (snapshot: SessionSnapshot) => {
    if (!waiting && isSending(snapshot))
      waiting = { previousTurn: snapshot.turnId };
    else if (!waiting && isTurnActive(snapshot)) waiting = {};
    if (
      waiting &&
      snapshot.turnId &&
      snapshot.turnId !== waiting.previousTurn &&
      !isSending(snapshot) &&
      isTurnOver(snapshot)
    ) {
      waiting = null;
      onEnded(snapshot);
    }
  };
}

export function useRuntimeOrchestrator(
  aomiClient: AomiClient,
  options: OrchestratorOptions,
) {
  const threads = useThreadContext();
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const clientRef = useRef(aomiClient);
  clientRef.current = aomiClient;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const managerRef = useRef<SessionManager | null>(null);
  const loaded = useRef(new Set<string>());
  const failedLoads = useRef(new Set<string>());
  const loading = useRef(new Map<string, Promise<void>>());
  const [, loadSettled] = useReducer((count: number) => count + 1, 0);
  const sessionSubscriptions = useRef(new Map<string, () => void>());

  if (!managerRef.current) {
    managerRef.current = new SessionManager(() => clientRef.current);
  }
  const sessionManager = managerRef.current;
  // Bumped whenever every chat is closed; work started before it is dropped.
  const generation = useRef(0);

  const refreshTitle = useCallback(
    (threadId: string, session: ClientSession) => {
      const titleAtRefresh =
        threadsRef.current.getThreadMetadata(threadId)?.title;
      void clientRef.current.agent.sessions
        .get(threadId)
        .then((saved) => {
          if (sessionManager.get(threadId) !== session) return;
          if (
            saved.title &&
            threadsRef.current.getThreadMetadata(threadId)?.title ===
              titleAtRefresh
          )
            threadsRef.current.updateThreadMetadata(threadId, {
              title: reconcileGeneratedThreadTitle(titleAtRefresh, saved.title),
            });
        })
        .catch((error) => console.debug("Unable to refresh chat title", error));
    },
    [sessionManager],
  );

  const getSession = useCallback(
    (threadId: string): ClientSession => {
      const runtime = optionsRef.current;
      const getUserState = () =>
        UserStateValue.withExt(
          runtime.getUserState(),
          "client_type",
          CLIENT_TYPE_WEB_UI,
        );
      const sessionOptions = {
        target: runtime.getTarget(),
        model: runtime.getModel?.(),
        clientId: runtime.getClientId?.(),
        getUserState,
        inferenceFunding: runtime.inferenceFunding,
        actions: runtime.getActions?.(),
        commits: runtime.getCommits?.(),
      };
      const existing = sessionManager.get(threadId);
      if (existing) {
        existing.syncRuntimeOptions(sessionOptions);
        return existing;
      }

      const session = sessionManager.getOrCreate(threadId, sessionOptions);
      let lastSeenTitle: string | undefined;
      const onSnapshot = watchTurnEnds((snapshot) => {
        optionsRef.current.onTurnEnded?.(threadId);
        if (!snapshot.title) refreshTitle(threadId, session);
      });
      sessionSubscriptions.current.set(
        threadId,
        session.subscribe(() => {
          const snapshot = session.getSnapshot();
          const metadata = threadsRef.current.getThreadMetadata(threadId);
          if (
            snapshot.pendingUserMessage &&
            metadata &&
            (metadata.title === "New Chat" ||
              isPlaceholderTitle(metadata.title))
          ) {
            threadsRef.current.updateThreadMetadata(threadId, {
              title:
                stripCapabilityHints(snapshot.pendingUserMessage)
                  .trim()
                  .slice(0, 80) || "New Chat",
            });
          }
          if (snapshot.title && snapshot.title !== lastSeenTitle) {
            lastSeenTitle = snapshot.title;
            threadsRef.current.updateThreadMetadata(threadId, {
              title: reconcileGeneratedThreadTitle(
                threadsRef.current.getThreadMetadata(threadId)?.title,
                snapshot.title,
              ),
            });
          }
          onSnapshot(snapshot);
          threadsRef.current.updateThreadMetadata(threadId, {
            pending: isSending(snapshot),
          });
        }),
      );
      return session;
    },
    [refreshTitle, sessionManager],
  );

  const closeSession = useCallback(
    (threadId: string) => {
      sessionSubscriptions.current.get(threadId)?.();
      sessionSubscriptions.current.delete(threadId);
      loaded.current.delete(threadId);
      failedLoads.current.delete(threadId);
      loading.current.delete(threadId);
      sessionManager.close(threadId);
    },
    [sessionManager],
  );

  const closeAllSessions = useCallback(() => {
    generation.current++;
    for (const unsubscribe of sessionSubscriptions.current.values()) {
      unsubscribe();
    }
    sessionSubscriptions.current.clear();
    loaded.current.clear();
    failedLoads.current.clear();
    loading.current.clear();
    sessionManager.closeAll();
  }, [sessionManager]);

  const ensureInitialState = useCallback(
    (threadId: string): Promise<void> => {
      if (loaded.current.has(threadId)) return Promise.resolve();
      const pending = loading.current.get(threadId);
      if (pending) return pending;
      const session = getSession(threadId);
      failedLoads.current.delete(threadId);
      const request = session
        .fetchCurrentState()
        .then(
          () => {
            if (sessionManager.get(threadId) === session)
              loaded.current.add(threadId);
          },
          (error: unknown) => {
            if (sessionManager.get(threadId) === session)
              failedLoads.current.add(threadId);
            throw error;
          },
        )
        .finally(() => {
          if (loading.current.get(threadId) === request) {
            loading.current.delete(threadId);
            loadSettled();
          }
        });
      loading.current.set(threadId, request);
      return request;
    },
    [getSession, sessionManager],
  );

  /** A remote chat whose history has not arrived (or failed) yet. */
  const isLoading = useCallback(
    (threadId: string) =>
      !loaded.current.has(threadId) && !failedLoads.current.has(threadId),
    [],
  );

  const sendOnce = useCallback(
    async (text: string, threadId: string, sendOptions?: SendOptions) => {
      const session = getSession(threadId);
      await session.sendAsync(text, sendOptions);
      if (sessionManager.get(threadId) !== session) return;
      loaded.current.add(threadId);
      optionsRef.current.onSendSuccess?.(threadId);
      threadsRef.current.updateThreadMetadata(threadId, {
        lastActiveAt: new Date().toISOString(),
      });
    },
    [getSession, sessionManager],
  );

  const reportFailure = useCallback(
    async (threadId: string, error: unknown, startedIn: number) => {
      if (startedIn === generation.current)
        await optionsRef.current.onSendError?.(threadId, error);
      throw error;
    },
    [],
  );

  const sendMessage = useCallback(
    async (text: string, threadId: string, sendOptions?: SendOptions) => {
      const startedIn = generation.current;
      try {
        await sendOnce(text, threadId, sendOptions);
        return;
      } catch (error) {
        const guestExpired =
          error instanceof AgentApiError &&
          error.isGuestIdentityChanged &&
          !sendOptions?.edit &&
          !sendOptions?.regenerate &&
          startedIn === generation.current &&
          threadsRef.current.currentThreadId === threadId;
        if (!guestExpired) return reportFailure(threadId, error, startedIn);
      }
      // The new guest cannot read the old guest's chat. Send the same text
      // once more in a fresh chat; no history or actions carry over.
      const control = threadsRef.current.getThreadMetadata(threadId)?.control;
      closeAllSessions();
      optionsRef.current.onGuestExpired?.();
      const freshThreadId = threadsRef.current.resetToDefault();
      if (control)
        threadsRef.current.updateThreadMetadata(freshThreadId, { control });
      const retriedIn = generation.current;
      try {
        await sendOnce(text, freshThreadId);
      } catch (error) {
        await reportFailure(freshThreadId, error, retriedIn);
      }
    },
    [closeAllSessions, reportFailure, sendOnce],
  );

  const cancelGeneration = useCallback(
    async (threadId: string) => {
      await sessionManager.get(threadId)?.interrupt();
    },
    [sessionManager],
  );

  const currentSession = getSession(threads.currentThreadId);
  const snapshot = useSyncExternalStore(
    currentSession.subscribe,
    currentSession.getSnapshot,
    currentSession.getSnapshot,
  );

  useEffect(() => closeAllSessions, [closeAllSessions]);

  return {
    sessionManager,
    currentSession,
    snapshot,
    getSession,
    ensureInitialState,
    isLoading,
    sendMessage,
    cancelGeneration,
    closeSession,
    closeAllSessions,
    aomiClientRef: clientRef,
  };
}
