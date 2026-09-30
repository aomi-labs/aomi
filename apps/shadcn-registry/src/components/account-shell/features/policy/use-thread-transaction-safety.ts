"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  TransactionSafetyMode,
  TransactionSafetyPolicy,
} from "@aomi-labs/client";
import { useShellTransport } from "../../transport";
import {
  fetchTransactionSafety,
  onTransactionSafetyDefaultChange,
  safetyErrorMessage,
  saveOrReloadTransactionSafety,
} from "./transaction-safety-api";

export type ThreadTransactionSafety = {
  account?: TransactionSafetyPolicy;
  /**
   * This chat's level: a held choice, else the thread's own. Only a chat that
   * hasn't started reads the account default; a started chat stays undefined
   * until its own policy loads, so it never shows a level it doesn't run on.
   */
  mode?: TransactionSafetyMode;
  /** A started chat's own policy failed to load; `retry` reloads it. */
  unavailable: boolean;
  /** A new chat's choice, held until `commitHeld` runs before its first send. */
  pending: boolean;
  /** The chat has a backend thread (its first message went out). */
  started: boolean;
  busy: boolean;
  error?: string;
  select: (mode: TransactionSafetyMode) => Promise<boolean>;
  /** Synchronous check for send paths; reads the latest held choice. */
  hasHeld: () => boolean;
  /**
   * Write the held choice before the first turn is sent. The PUT creates the
   * thread server-side, so the first turn already runs under the chosen level.
   */
  commitHeld: () => Promise<boolean>;
  refreshAccount: () => void;
  /** Reload this chat's policy and the account default. */
  retry: () => void;
};

/**
 * Per-chat transaction safety. Before a new chat's first message
 * (`threadReady` false) a choice is only held; the owner of the send path must
 * `commitHeld` before sending (`canHold`), otherwise the level stays locked
 * until the chat has started so turn one never runs under a stale level.
 */
export function useThreadTransactionSafety({
  threadId,
  threadReady,
  enabled = true,
  canHold = false,
}: {
  threadId?: string;
  threadReady: boolean;
  enabled?: boolean;
  canHold?: boolean;
}): ThreadTransactionSafety {
  const { json: request } = useShellTransport();
  const [account, setAccount] = useState<TransactionSafetyPolicy>();
  const [accountRequest, setAccountRequest] = useState(0);
  const [thread, setThread] = useState<{
    id: string;
    policy: TransactionSafetyPolicy;
  }>();
  const [threadRequest, setThreadRequest] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState<{
    threadId: string;
    mode: TransactionSafetyMode;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const heldRef = useRef(pending);
  heldRef.current = pending;
  const committing = useRef<Promise<boolean> | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setAccount(undefined);
      return;
    }
    let cancelled = false;
    void fetchTransactionSafety(request)
      .then((policy) => {
        if (!cancelled) setAccount(policy);
      })
      .catch(() => {
        if (!cancelled) setAccount(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [accountRequest, enabled, request]);

  useEffect(() => {
    if (!enabled) return;
    return onTransactionSafetyDefaultChange(setAccount);
  }, [enabled]);

  useEffect(() => {
    const current = ++generation.current;
    setBusy(false);
    setError(undefined);
    setLoadFailed(false);
    // Keep a level just saved for this chat (its held choice, committed before
    // turn one) while the reload runs.
    setThread((known) =>
      enabled && known?.id === threadId ? known : undefined,
    );
    setPending((held) => (held?.threadId === threadId ? held : undefined));
    if (!enabled || !threadId || !threadReady) return;
    void fetchTransactionSafety(request, threadId)
      .then((policy) => {
        if (current === generation.current) setThread({ id: threadId, policy });
      })
      .catch((cause: unknown) => {
        if (current !== generation.current) return;
        setLoadFailed(true);
        setError(
          safetyErrorMessage(cause, "Could not load this chat's safety level."),
        );
      });
  }, [enabled, request, threadId, threadReady, threadRequest]);

  const write = useCallback(
    async (
      id: string,
      prior: TransactionSafetyPolicy,
      mode: TransactionSafetyMode,
    ) => {
      const current = generation.current;
      setBusy(true);
      setError(undefined);
      const saved = await saveOrReloadTransactionSafety(
        request,
        mode,
        prior.revision,
        id,
      );
      if (current !== generation.current) return false;
      setBusy(false);
      if (saved.ok) {
        setThread({ id, policy: saved.policy });
        return true;
      }
      setError(
        safetyErrorMessage(
          saved.error,
          "Could not change this chat's safety level.",
        ),
      );
      if (saved.latest) setThread({ id, policy: saved.latest });
      return false;
    },
    [request],
  );

  const select = useCallback(
    async (mode: TransactionSafetyMode) => {
      if (!enabled || !threadId || busy) return false;
      if (!threadReady) {
        if (!canHold) return false;
        setError(undefined);
        const next = mode === account?.mode ? undefined : { threadId, mode };
        heldRef.current = next;
        setPending(next);
        return true;
      }
      const prior =
        thread?.id === threadId
          ? thread.policy
          : await fetchTransactionSafety(request, threadId).catch(
              () => undefined,
            );
      if (!prior) {
        setError("Could not load this chat's safety level.");
        return false;
      }
      return prior.mode === mode ? true : write(threadId, prior, mode);
    },
    [
      account?.mode,
      busy,
      canHold,
      enabled,
      request,
      thread,
      threadId,
      threadReady,
      write,
    ],
  );

  const hasHeld = useCallback(
    () => Boolean(threadId && heldRef.current?.threadId === threadId),
    [threadId],
  );

  const commitOnce = useCallback(async () => {
    const held = heldRef.current;
    if (!held || held.threadId !== threadId) return true;
    setBusy(true);
    setError(undefined);
    // An unsent chat reads as the account default with that revision; the
    // PUT materializes the thread from the same snapshot.
    const prior = await fetchTransactionSafety(request, held.threadId).catch(
      () => undefined,
    );
    if (!prior) {
      setBusy(false);
      setError("Could not set this chat's safety level. Try again.");
      return false;
    }
    const saved =
      prior.mode === held.mode ||
      (await write(held.threadId, prior, held.mode));
    if (saved && heldRef.current === held) {
      heldRef.current = undefined;
      setPending(undefined);
    }
    if (!saved)
      setError((current) =>
        current ? `Message not sent. ${current}` : "Message not sent.",
      );
    setBusy(false);
    return saved;
  }, [request, threadId, write]);

  // A second send while the first save is in flight (Enter, then the
  // form's own `requestSubmit`) joins that save rather than starting another.
  const commitHeld = useCallback(() => {
    committing.current ??= commitOnce().finally(() => {
      committing.current = undefined;
    });
    return committing.current;
  }, [commitOnce]);

  const refreshAccount = useCallback(
    () => setAccountRequest((value) => value + 1),
    [],
  );
  const retry = useCallback(() => {
    setAccountRequest((value) => value + 1);
    setThreadRequest((value) => value + 1);
  }, []);

  const held = pending?.threadId === threadId ? pending : undefined;
  const own = thread && thread.id === threadId ? thread.policy.mode : undefined;
  const mode = held?.mode ?? (threadReady ? own : account?.mode);
  return {
    account,
    mode,
    unavailable: mode === undefined && loadFailed,
    pending: Boolean(held),
    started: threadReady,
    busy,
    error,
    select,
    hasHeld,
    commitHeld,
    refreshAccount,
    retry,
  };
}
