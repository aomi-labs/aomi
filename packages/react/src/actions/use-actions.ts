"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  Action,
  ActionAttempt,
  ActionResult,
  Session as ClientSession,
} from "@aomi-labs/client";

const NO_ACTIONS: Action[] = [];
const NO_ATTEMPTS = new Map<string, ActionAttempt>();

export function useActions(session: ClientSession | undefined) {
  const subscribe = useCallback(
    (listener: () => void) => session?.subscribe(listener) ?? (() => undefined),
    [session],
  );
  const getActions = useCallback(
    () => session?.getSnapshot().actions ?? NO_ACTIONS,
    [session],
  );
  const actions = useSyncExternalStore(subscribe, getActions, getActions);
  const getAttempts = useCallback(
    () => session?.getSnapshot().actionAttempts ?? NO_ATTEMPTS,
    [session],
  );
  const actionAttempts = useSyncExternalStore(
    subscribe,
    getAttempts,
    getAttempts,
  );
  const pendingActions = useMemo(
    () => actions.filter((action) => action.state === "pending"),
    [actions],
  );

  return {
    pendingActions,
    actionAttempts,
    hasBlockingActions:
      pendingActions.length > 0 || Boolean(session?.actions.isBlocking()),
    executeAction: (id: string) =>
      requireSession(session)
        .actions
        .execute(id)
        .then(() => undefined),
    respondToAction: (id: string, result: ActionResult) =>
      requireSession(session)
        .actions
        .submitResult(id, result)
        .then(() => undefined),
    rejectAction: (id: string, reason?: string) =>
      requireSession(session)
        .actions
        .reject(id, reason)
        .then(() => undefined),
  };
}

function requireSession(session: ClientSession | undefined): ClientSession {
  if (!session) throw new Error("No ClientSession is available");
  return session;
}
