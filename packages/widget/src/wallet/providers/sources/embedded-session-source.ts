"use client";

import { useEffect, useMemo, useRef } from "react";
import type { WalletRegistryStore } from "../../registry/store";

export type EmbeddedSessionSourceSnapshot = {
  up: boolean;
  providerId: string;
  uid: string;
  stableId: string;
  walletName: string;
  embeddedEvmAddress: string | null;
  chainId?: number | null;
};

export function useEmbeddedSessionSource(
  store: WalletRegistryStore,
  snapshot: EmbeddedSessionSourceSnapshot,
): void {
  const {
    chainId,
    embeddedEvmAddress,
    providerId,
    stableId,
    uid,
    up,
    walletName,
  } = snapshot;
  const snapshotKey = useMemo(
    () =>
      `${up ? "up" : "down"}:${providerId}:${uid}:${stableId}:${walletName}:${
        embeddedEvmAddress?.toLowerCase() ?? ""
      }:${chainId ?? ""}`,
    [chainId, embeddedEvmAddress, providerId, stableId, uid, up, walletName],
  );
  const previousKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (previousKeyRef.current === snapshotKey) return;
    previousKeyRef.current = snapshotKey;
    store.dispatch({
      type: "provider/embedded-session-changed",
      up,
      providerId,
      uid,
      stableId,
      walletName,
      embeddedEvmAddress,
      chainId,
      now: Date.now(),
    });
  }, [
    chainId,
    embeddedEvmAddress,
    providerId,
    stableId,
    store,
    snapshotKey,
    uid,
    up,
    walletName,
  ]);
}
