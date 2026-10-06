"use client";

import { useEffect, useMemo, useRef } from "react";
import type { WalletRegistryStore } from "../../registry/store";
import type { SafeSvmWalletState } from "./wallet-runtime";

export function useSvmRegistrySource(
  store: WalletRegistryStore,
  opts: { svmWallet: SafeSvmWalletState },
): void {
  const snapshotKey = useMemo(
    () =>
      `${opts.svmWallet.publicKey ?? ""}:${opts.svmWallet.walletName ?? ""}`,
    [opts.svmWallet.publicKey, opts.svmWallet.walletName],
  );
  const previousKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (previousKeyRef.current === snapshotKey) return;
    previousKeyRef.current = snapshotKey;
    store.dispatch({
      type: "svm/changed",
      publicKey: opts.svmWallet.publicKey ?? null,
      kind: opts.svmWallet.transport === "embedded" ? "embedded-session" : "svm",
      providerId: opts.svmWallet.providerId,
      walletName: opts.svmWallet.walletName ?? null,
      now: Date.now(),
    });
  }, [opts.svmWallet.publicKey, opts.svmWallet.walletName, snapshotKey, store]);

}
