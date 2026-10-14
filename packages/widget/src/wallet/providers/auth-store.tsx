"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { AOMI_BOOTING_WALLET_KIT } from "@/wallet/context";
import { type PrivyDelegationContextValue } from "@/wallet/providers/privy/privy-delegation-context";
import type { AomiWalletKit } from "@/wallet/types";

/** Longest a provider handover keeps the previous kit on screen. */
const HANDOVER_MAX_MS = 8_000;

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
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // While one provider runtime hands over to another, the last kit stays on
  // screen (marked settling) until the new one has its account, so Settings
  // and the account chip don't blank out while an SDK loads.
  let handover: {
    timer: ReturnType<typeof setTimeout>;
    pending: AomiWalletKit;
  } | null = null;
  const show = (kit: AomiWalletKit) => {
    if (snapshot.kit === kit) return;
    snapshot = { ...snapshot, kit };
    notify();
  };
  const endHandover = () => {
    if (!handover) return;
    clearTimeout(handover.timer);
    const { pending } = handover;
    handover = null;
    show(pending);
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(next: AomiWalletKit) {
      if (handover) {
        handover.pending = next;
        if (next.isReady && next.accountStatus !== "loading") endHandover();
        return;
      }
      show(next);
    },
    /** The runtime is about to remount under another provider. */
    beginHandover() {
      if (handover) return;
      const current = snapshot.kit;
      if (current === AOMI_BOOTING_WALLET_KIT || !current.isReady) {
        show(AOMI_BOOTING_WALLET_KIT);
        return;
      }
      handover = {
        pending: AOMI_BOOTING_WALLET_KIT,
        timer: setTimeout(endHandover, HANDOVER_MAX_MS),
      };
      show({ ...current, isSettling: true });
    },
    publishDelegation(next: PrivyDelegationContextValue | null) {
      snapshot = { ...snapshot, delegation: next ?? unavailable };
      notify();
    },
    publishFailure(failure: string | null) {
      if (failure) endHandover();
      if (snapshot.failure === failure) return;
      snapshot = { ...snapshot, failure };
      notify();
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
