"use client";

import { useEffect, useMemo, useRef } from "react";
import type { WalletRegistryStore } from "@/wallet/registry/store";
import { useEmbeddedSessionSource } from "@/wallet/providers/sources/embedded-session-source";
import {
  PARA_BRAND_KEY,
  PARA_SESSION_UID,
} from "@/wallet/providers/para/para-brand";
import { parseChainId } from "@aomi-labs/client";

type ParaAccountSnapshot = {
  isConnected: boolean;
  embedded: {
    wallets?: ParaEmbeddedWallet[];
  };
  external: {
    evm?: {
      address?: string;
      chainId?: number | string;
    };
    solana?: {
      publicKey?: unknown;
      address?: string;
      name?: string;
    };
  };
};

type ParaEmbeddedWallet = {
  id?: string;
  address?: string;
  chainId?: number | string;
  type?: string;
  walletType?: string;
  isExternal?: boolean;
};

function walletType(wallet: ParaEmbeddedWallet): string {
  return (wallet.type ?? wallet.walletType ?? "").toUpperCase();
}

function isExternalEmbeddedWallet(wallet: ParaEmbeddedWallet): boolean {
  return wallet.isExternal === true;
}

function isEvmEmbeddedWallet(wallet: ParaEmbeddedWallet): boolean {
  const type = walletType(wallet);
  return (
    type === "EVM" ||
    type === "ETHEREUM" ||
    Boolean(wallet.chainId) ||
    /^0x[0-9a-fA-F]{40}$/.test(wallet.address ?? "")
  );
}

function isSolanaEmbeddedWallet(wallet: ParaEmbeddedWallet): boolean {
  const type = walletType(wallet);
  return type === "SOLANA" || type === "SVM";
}

function toSolanaAddress(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as {
    toBase58?: () => string;
    toString?: () => string;
  };
  const encoded =
    typeof record.toBase58 === "function"
      ? record.toBase58()
      : typeof record.toString === "function"
        ? record.toString()
        : "";
  return encoded.trim() || null;
}

export function useParaSessionSource(
  store: WalletRegistryStore,
  opts: { paraAccount: ParaAccountSnapshot },
): void {
  const embeddedWallets =
    opts.paraAccount.embedded.wallets?.filter(
      (wallet) => !isExternalEmbeddedWallet(wallet),
    ) ?? [];
  const embeddedEvmWallet = embeddedWallets.find(isEvmEmbeddedWallet);
  const embeddedSolanaWallet = embeddedWallets.find(isSolanaEmbeddedWallet);
  const embeddedEvmAddress =
    opts.paraAccount.external.evm?.address ??
    embeddedEvmWallet?.address ??
    null;
  const embeddedSolanaAddress =
    embeddedSolanaWallet?.address ??
    toSolanaAddress(opts.paraAccount.external.solana?.publicKey) ??
    toSolanaAddress(opts.paraAccount.external.solana?.address);
  const chainId =
    parseChainId(opts.paraAccount.external.evm?.chainId) ??
    parseChainId(embeddedEvmWallet?.chainId) ??
    null;
  const snapshotKey = useMemo(
    () =>
      `${opts.paraAccount.isConnected ? "up" : "down"}:${
        embeddedSolanaAddress ?? ""
      }:${embeddedSolanaWallet?.id ?? ""}`,
    [
      embeddedSolanaAddress,
      embeddedSolanaWallet?.id,
      opts.paraAccount.isConnected,
    ],
  );
  const previousKeyRef = useRef<string | null>(null);

  useEmbeddedSessionSource(store, {
    up: opts.paraAccount.isConnected,
    providerId: PARA_BRAND_KEY,
    uid: PARA_SESSION_UID,
    stableId: PARA_BRAND_KEY,
    walletName: "Para",
    embeddedEvmAddress,
    chainId,
  });

  useEffect(() => {
    if (previousKeyRef.current === snapshotKey) return;
    previousKeyRef.current = snapshotKey;
    store.dispatch({
      type: "svm/changed",
      publicKey:
        opts.paraAccount.isConnected && embeddedSolanaAddress
          ? embeddedSolanaAddress
          : null,
      uid: "para-solana-session",
      stableId: "para",
      kind: "embedded-session",
      providerId: "para",
      walletName: "Para",
      now: Date.now(),
    });
  }, [embeddedSolanaAddress, opts.paraAccount.isConnected, snapshotKey, store]);
}
