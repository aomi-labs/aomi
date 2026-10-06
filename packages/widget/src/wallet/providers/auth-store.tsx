"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { AOMI_BOOTING_WALLET_KIT } from "@/wallet/context";
import { type PrivyDelegationContextValue } from "@/wallet/providers/privy/privy-delegation-context";
import type { AomiWalletKit } from "@/wallet/types";

/** One store per mounted wallet kit. SDK trees publish; chat observes without reparenting. */
export function createWalletAuthStore() {
  const unavailable: PrivyDelegationContextValue = {
    start: async () => {
      throw new Error("Privy is not configured for this app.");
    },
  };
  let snapshot = {
    kit: AOMI_BOOTING_WALLET_KIT,
    delegation: unavailable,
    /** Why the provider island could not start; shown inside the widget. */
    failure: null as string | null,
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(next: AomiWalletKit) {
      if (snapshot.kit === next) return;
      snapshot = { ...snapshot, kit: next };
      for (const listener of listeners) listener();
    },
    publishDelegation(next: PrivyDelegationContextValue | null) {
      snapshot = { ...snapshot, delegation: next ?? unavailable };
      for (const listener of listeners) listener();
    },
    publishFailure(failure: string | null) {
      if (snapshot.failure === failure) return;
      snapshot = { ...snapshot, failure };
      for (const listener of listeners) listener();
    },
  };
}
export type WalletAuthStore = ReturnType<typeof createWalletAuthStore>;
export const WalletAuthPublisherContext = createContext<
  ((kit: AomiWalletKit) => void) | null
>(null);
export const WalletDelegationPublisherContext = createContext<
  ((value: PrivyDelegationContextValue | null) => void) | null
>(null);
export const useWalletAuthPublisher = () =>
  useContext(WalletAuthPublisherContext);
export function useWalletAuthStore(store: WalletAuthStore) {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
