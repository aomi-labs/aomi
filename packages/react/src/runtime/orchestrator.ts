"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import {
  CLIENT_TYPE_WEB_UI,
  Session as ClientSession,
  UserState as UserStateValue,
  type ActionCapabilities,
  type CommitCapabilities,
  type AgentTarget,
  type AomiClient,
  type SendOptions,
  type UserState,
} from "@aomi-labs/client";
import type { AomiInferenceFundingSource } from "../interface";
import { useThreadContext } from "../contexts/thread-context";
import { SessionManager } from "./session-manager";
import { isPlaceholderTitle, reconcileGeneratedThreadTitle } from "./utils";
import { stripCapabilityHints } from "./capability-hints";

type OrchestratorOptions = {
  getUserState: () => UserState;
  getTarget: () => AgentTarget;
  getModel?: () => string | null | undefined;
  getClientId?: () => string | undefined;
  inferenceFunding?: AomiInferenceFundingSource;
  getActions?: () => ActionCapabilities | undefined;
  getCommits?: () => CommitCapabilities | undefined;
  prepareThreadForSend?: (threadId: string) => Promise<void> | void;
  onSendSuccess?: (threadId: string) => void;
  onSendError?: (threadId: string, error: unknown) => Promise<void> | void;
};

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
  const hydrated = useRef(new Set<string>());
  const hydration = useRef(new Map<string, Promise<void>>());
  const sessionSubscriptions = useRef(new Map<string, () => void>());

  if (!managerRef.current) {
    managerRef.current = new SessionManager(() => clientRef.current);
  }
  const sessionManager = managerRef.current;

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
          const pending =
            snapshot.isSubmitting || Boolean(snapshot.isStartUncertain);
          if (metadata?.pending !== pending) {
            threadsRef.current.updateThreadMetadata(threadId, {
              pending,
            });
          }
        }),
      );
      return session;
    },
    [sessionManager],
  );

  const closeSession = useCallback(
    (threadId: string) => {
      sessionSubscriptions.current.get(threadId)?.();
      sessionSubscriptions.current.delete(threadId);
      hydrated.current.delete(threadId);
      hydration.current.delete(threadId);
      sessionManager.close(threadId);
    },
    [sessionManager],
  );

  const closeAllSessions = useCallback(() => {
    for (const unsubscribe of sessionSubscriptions.current.values()) {
      unsubscribe();
    }
    sessionSubscriptions.current.clear();
    hydrated.current.clear();
    hydration.current.clear();
    sessionManager.closeAll();
  }, [sessionManager]);

  const ensureInitialState = useCallback(
    (threadId: string): Promise<void> => {
      if (hydrated.current.has(threadId)) return Promise.resolve();
      const pending = hydration.current.get(threadId);
      if (pending) return pending;
      const request = getSession(threadId)
        .fetchCurrentState()
        .then(() => {
          hydrated.current.add(threadId);
        })
        .finally(() => hydration.current.delete(threadId));
      hydration.current.set(threadId, request);
      return request;
    },
    [getSession],
  );

  const sendMessage = useCallback(
    async (text: string, threadId: string, sendOptions?: SendOptions) => {
      try {
        await optionsRef.current.prepareThreadForSend?.(threadId);
        const session = getSession(threadId);
        const hadTurn = Boolean(session.getSnapshot().turnId);
        await session.sendAsync(text, sendOptions);
        optionsRef.current.onSendSuccess?.(threadId);
        threadsRef.current.updateThreadMetadata(threadId, {
          lastActiveAt: new Date().toISOString(),
        });
        // A turn's title event can arrive separately from its start response.
        // Reconcile the saved summary without waiting for a full page reload.
        if (hadTurn || sendOptions || session.getSnapshot().title) return;
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
                title: reconcileGeneratedThreadTitle(
                  titleAtRefresh,
                  saved.title,
                ),
              });
          })
          .catch((error) =>
            console.debug("Unable to refresh chat title", error),
          );
      } catch (error) {
        await optionsRef.current.onSendError?.(threadId, error);
        throw error;
      }
    },
    [getSession],
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
    sendMessage,
    cancelGeneration,
    closeSession,
    closeAllSessions,
    aomiClientRef: clientRef,
  };
}
