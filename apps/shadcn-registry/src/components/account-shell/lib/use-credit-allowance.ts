"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useAomiWalletKit } from "../../../lib/wallet-kit/context";
import { fetchCreditAllowance } from "../features/usage/statement-api";
import { useShellTransport, type ShellRequest } from "../transport";
import type { CreditAllowance } from "./account-overview";

type Snapshot = {
  data?: CreditAllowance & { period?: string };
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
};
const empty: Snapshot = { status: "idle" };

export function createCreditAllowanceStore(request: ShellRequest) {
  let snapshot = empty;
  let inflight: Promise<void> | undefined;
  let updatedAt = 0;
  const listeners = new Set<() => void>();
  const emit = (next: Snapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const refresh = (force = false): Promise<void> => {
    if (inflight) return inflight;
    if (!force && updatedAt && Date.now() - updatedAt < 30_000)
      return Promise.resolve();
    emit({ ...snapshot, status: "loading", error: undefined });
    inflight = fetchCreditAllowance(request)
      .then((data) => {
        updatedAt = Date.now();
        emit({ data, status: "ready" });
      })
      .catch(() => {
        emit({
          ...snapshot,
          status: "error",
          error: "Couldn’t refresh your allowance. Try again.",
        });
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };
  return {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
  };
}

const stores = new WeakMap<
  ShellRequest,
  Map<string, ReturnType<typeof createCreditAllowanceStore>>
>();

/** Cache access and snapshots by transport and canonical account, never signer. */
export function useCreditAllowance() {
  const { json: request } = useShellTransport();
  const adapter = useAomiWalletKit();
  const userId = adapter.accountGuest ? undefined : adapter.accountUser?.id;
  let byAccount = stores.get(request);
  if (!byAccount) {
    byAccount = new Map();
    stores.set(request, byAccount);
  }
  // Unscoped consumers get their own store rather than sharing account data.
  const local = useMemo(() => createCreditAllowanceStore(request), [request]);
  let store = userId ? byAccount.get(userId) : local;
  if (!store) {
    store = createCreditAllowanceStore(request);
    byAccount.set(userId!, store);
  }
  const state = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    () => empty,
  );
  useEffect(() => {
    if (userId) void store.refresh();
  }, [userId, store]);
  const refresh = useCallback(
    () => (userId ? store.refresh(true) : Promise.resolve()),
    [userId, store],
  );
  return { ...state, refresh };
}
