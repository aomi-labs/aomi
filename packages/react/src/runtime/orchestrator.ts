"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import {
  CLIENT_TYPE_WEB_UI,
  Session as ClientSession,
  UserState as UserStateValue,
  type ActionCapabilities,
  type AomiClient,
  type UserState,
} from "@aomi-labs/client";
import type { AomiInferenceFundingSource } from "../interface";
import { useThreadContext } from "../contexts/thread-context";
import { SessionManager } from "./session-manager";

type OrchestratorOptions = {
  getUserState: () => UserState;
  getApp: () => string;
  getModel?: () => string | null | undefined;
  getApplicationId?: () => number | string | null | undefined;
  getClientId?: () => string | undefined;
  inferenceFunding?: AomiInferenceFundingSource;
  getActions?: () => ActionCapabilities | undefined;
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
        app: runtime.getApp(),
        model: runtime.getModel?.(),
        applicationId: runtime.getApplicationId?.(),
        clientId: runtime.getClientId?.(),
        getUserState,
        inferenceFunding: runtime.inferenceFunding,
        actions: runtime.getActions?.(),
      };
      const existing = sessionManager.get(threadId);
      if (existing) {
        existing.syncRuntimeOptions(sessionOptions);
        return existing;
      }

      const session = sessionManager.getOrCreate(threadId, sessionOptions);
      sessionSubscriptions.current.set(
        threadId,
        session.subscribe(() => {
          const snapshot = session.getSnapshot();
          const metadata = threadsRef.current.getThreadMetadata(threadId);
          if (snapshot.title && metadata?.title !== snapshot.title) {
            threadsRef.current.updateThreadMetadata(threadId, {
              title: snapshot.title,
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
    async (text: string, threadId: string) => {
      try {
        await optionsRef.current.prepareThreadForSend?.(threadId);
        const session = getSession(threadId);
        await session.sendAsync(text);
        threadsRef.current.updateThreadMetadata(threadId, {
          lastActiveAt: new Date().toISOString(),
        });
        optionsRef.current.onSendSuccess?.(threadId);
      } catch (error) {
        await optionsRef.current.onSendError?.(threadId, error);
        throw error;
      }
    },
    [getSession],
  );

  const cancelGeneration = useCallback(async (threadId: string) => {
    await sessionManager.get(threadId)?.interrupt();
  }, [sessionManager]);

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
