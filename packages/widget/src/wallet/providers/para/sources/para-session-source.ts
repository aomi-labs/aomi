"use client";

import { useEffect, useMemo, useRef } from "react";
import type { WalletRegistryStore } from "../../../registry/store";
import { useEmbeddedSessionSource } from "../../sources/embedded-session-source";
import { PARA_BRAND_KEY, PARA_SESSION_UID } from "../para-brand";

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

function normalizeChainId(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const chainId =
    typeof value === "string" && /^0x/i.test(value)
      ? Number.parseInt(value, 16)
      : Number(value);
  return Number.isInteger(chainId) && chainId > 0 ? chainId : null;
}

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
    normalizeChainId(opts.paraAccount.external.evm?.chainId) ??
    normalizeChainId(embeddedEvmWallet?.chainId);
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
