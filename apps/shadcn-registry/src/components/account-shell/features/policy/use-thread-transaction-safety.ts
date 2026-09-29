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
  saveTransactionSafety,
} from "./transaction-safety-api";

export type ThreadTransactionSafety = {
  /** The account default loaded, so the safety API is reachable. */
  available: boolean;
  account?: TransactionSafetyPolicy;
  /** This chat's level: a held choice, else the thread's, else the default. */
  mode?: TransactionSafetyMode;
  /** A new chat's choice, held until `commitHeld` runs before its first send. */
  pending: boolean;
  /** Whether a chat without a backend thread may hold a choice at all. */
  canHold: boolean;
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
};

function message(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

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
  const [pending, setPending] = useState<{
    threadId: string;
    mode: TransactionSafetyMode;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const heldRef = useRef(pending);
  heldRef.current = pending;

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
    setThread(undefined);
    setPending((held) => (held?.threadId === threadId ? held : undefined));
    if (!enabled || !threadId || !threadReady) return;
    void fetchTransactionSafety(request, threadId)
      .then((policy) => {
        if (current === generation.current) setThread({ id: threadId, policy });
      })
      .catch((cause: unknown) => {
        if (current === generation.current)
          setError(message(cause, "Could not load this chat's safety level."));
      });
  }, [enabled, request, threadId, threadReady]);

  const write = useCallback(
    async (
      id: string,
      prior: TransactionSafetyPolicy,
      mode: TransactionSafetyMode,
    ) => {
      const current = generation.current;
      setBusy(true);
      setError(undefined);
      try {
        const policy = await saveTransactionSafety(
          request,
          mode,
          prior.revision,
          id,
        );
        if (current === generation.current) setThread({ id, policy });
        return current === generation.current;
      } catch (cause) {
        if (current !== generation.current) return false;
        setError(message(cause, "Could not change this chat's safety level."));
        // Read the latest revision after a conflict; never silently retry a write.
        try {
          const latest = await fetchTransactionSafety(request, id);
          if (current === generation.current) setThread({ id, policy: latest });
        } catch {
          /* Keep the original error; admission stays server-owned. */
        }
        return false;
      } finally {
        if (current === generation.current) setBusy(false);
      }
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

  const commitHeld = useCallback(async () => {
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

  const refreshAccount = useCallback(
    () => setAccountRequest((value) => value + 1),
    [],
  );

  const held = pending?.threadId === threadId ? pending : undefined;
  return {
    available: Boolean(account),
    account,
    mode:
      held?.mode ??
      (thread && thread.id === threadId ? thread.policy.mode : undefined) ??
      account?.mode,
    pending: Boolean(held),
    canHold,
    started: threadReady,
    busy,
    error,
    select,
    hasHeld,
    commitHeld,
    refreshAccount,
  };
}
