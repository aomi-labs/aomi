"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import {
  Connection as SolanaConnection,
  Transaction as SolanaTransaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type {
  AomiWalletOption,
  SvmNetworkOption,
  SvmWalletDescriptor,
} from "../../types";
import { SVM_WALLET_ALLOWLIST } from "../../catalog/svm-wallet-catalog";
import { canonicalWalletKey } from "../../catalog/wallet-branding";
import { selectAccounts, selectSvmIdentity } from "../../registry/selectors";
import type { WalletRegistryStore } from "../../registry/store";
import type { SvmWalletRuntime } from "../../composer/types";
import {
  DEFAULT_SVM_CLUSTER,
  DEFAULT_SVM_RPC_HTTP_URLS,
} from "../../catalog/svm-networks";
import { useSvmRegistrySource } from "./registry-source";
import { buildSvmTransactionMethods } from "./transactions";

export type SafeSvmWalletState = {
  publicKey: string | undefined;
  connected: boolean;
  connecting: boolean;
  disconnecting: boolean;
  walletName: string | undefined;
  providerId?: string;
  transport?: "extension" | "embedded" | "mwa";
  wallets: Array<{
    adapter: {
      name: string;
      readyState: SvmWalletReadyState;
    };
    readyState: SvmWalletReadyState;
  }>;
  select: ((walletName: SvmWalletName) => void) | undefined;
  connect: (() => Promise<void>) | undefined;
  disconnect: (() => Promise<void>) | undefined;
  signTransaction:
    | ((
        tx: VersionedTransaction | SolanaTransaction,
      ) => Promise<VersionedTransaction | SolanaTransaction>)
    | undefined;
  signAllTransactions:
    | ((
        txs: Array<VersionedTransaction | SolanaTransaction>,
      ) => Promise<Array<VersionedTransaction | SolanaTransaction>>)
    | undefined;
  signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | undefined;
  sendTransaction:
    | ((
        tx: VersionedTransaction | SolanaTransaction,
        connection: SolanaConnection,
      ) => Promise<string>)
    | undefined;
};

const DISCONNECTED_SVM_WALLET: SafeSvmWalletState = {
  publicKey: undefined,
  connected: false,
  connecting: false,
  disconnecting: false,
  walletName: undefined,
  wallets: [],
  select: undefined,
  connect: undefined,
  disconnect: undefined,
  signTransaction: undefined,
  signAllTransactions: undefined,
  signMessage: undefined,
  sendTransaction: undefined,
};

export const DEFAULT_SVM_ENDPOINT =
  DEFAULT_SVM_RPC_HTTP_URLS[DEFAULT_SVM_CLUSTER];
const SVM_AUTOCONNECT_GRACE_MS = 400;

type SvmWalletSource = "external" | "embedded";

type SvmWalletReadyState =
  | "Installed"
  | "NotDetected"
  | "Loadable"
  | "Unsupported";
type SvmWalletName = Parameters<
  ReturnType<typeof useSolanaWallet>["select"]
>[0];

/**
 * Outside a `WalletProvider`, `useWallet()` does not throw — it returns the
 * adapter library's DEFAULT_CONTEXT, whose `publicKey`/`wallet`/`wallets` are
 * accessor properties that `console.error` a missing-provider message on every
 * read. A provider-supplied context value is a plain object with data
 * properties, so an accessor on `publicKey` identifies the default context
 * without invoking the getter (descriptor lookups do not run getters).
 */
function isMissingSvmProviderContext(
  wallet: ReturnType<typeof useSolanaWallet>,
): boolean {
  return Boolean(Object.getOwnPropertyDescriptor(wallet, "publicKey")?.get);
}

export function useSafeSvmWallet(): SafeSvmWalletState {
  const context = useSolanaWallet();
  if (isMissingSvmProviderContext(context)) {
    return DISCONNECTED_SVM_WALLET;
  }
  try {
    const wallet = context;
    return {
      publicKey: wallet.publicKey?.toBase58(),
      connected: wallet.connected,
      connecting: wallet.connecting,
      disconnecting: wallet.disconnecting,
      walletName: wallet.wallet?.adapter?.name,
      wallets: wallet.wallets,
      select: wallet.select,
      connect: wallet.connect,
      disconnect: wallet.disconnect,
      signTransaction: wallet.signTransaction,
      signAllTransactions: wallet.signAllTransactions,
      signMessage: wallet.signMessage,
      sendTransaction: wallet.sendTransaction,
    };
  } catch {
    return DISCONNECTED_SVM_WALLET;
  }
}

function hasSelectedSvmWallet(wallet: SafeSvmWalletState): boolean {
  return Boolean(
    wallet.publicKey ||
    wallet.connected ||
    wallet.connecting ||
    wallet.walletName,
  );
}

/**
 * Keep the standard Solana wallet-adapter source available when an auth
 * provider also contributes embedded Solana wallets. Provider plugins augment
 * the generic source; they never replace it.
 */
export function useMergedSvmWallet(
  external: SafeSvmWalletState,
  embedded: SafeSvmWalletState,
): SafeSvmWalletState {
  const preferredSource = hasSelectedSvmWallet(external)
    ? "external"
    : hasSelectedSvmWallet(embedded)
      ? "embedded"
      : "external";
  const [selectedSource, setSelectedSource] =
    useState<SvmWalletSource>(preferredSource);
  const sourceSelectedByUser = useRef(false);

  useEffect(() => {
    if (sourceSelectedByUser.current) return;
    setSelectedSource(preferredSource);
  }, [preferredSource]);

  const active = selectedSource === "external" ? external : embedded;
  const externalNames = useMemo(
    () => new Set(external.wallets.map((entry) => entry.adapter.name)),
    [external.wallets],
  );
  const embeddedNames = useMemo(
    () => new Set(embedded.wallets.map((entry) => entry.adapter.name)),
    [embedded.wallets],
  );
  const wallets = useMemo(() => {
    const seen = new Set<string>();
    return [...external.wallets, ...embedded.wallets].filter((entry) => {
      const name = String(entry.adapter.name);
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }, [embedded.wallets, external.wallets]);
  const select = useCallback(
    (walletName: SvmWalletName) => {
      const name = String(walletName);
      if (externalNames.has(name)) {
        sourceSelectedByUser.current = true;
        setSelectedSource("external");
        external.select?.(walletName);
        return;
      }
      if (embeddedNames.has(name)) {
        sourceSelectedByUser.current = true;
        setSelectedSource("embedded");
        embedded.select?.(walletName);
      }
    },
    [embedded, embeddedNames, external, externalNames],
  );

  return useMemo(
    () => ({
      ...active,
      wallets,
      select,
    }),
    [active, select, wallets],
  );
}

export function detectSvmTransport(
  walletName: string | undefined,
): "extension" | "embedded" | "mwa" {
  const normalized = walletName?.toLowerCase() ?? "";
  if (
    normalized.includes("mobile wallet adapter") ||
    normalized.includes("solana mobile") ||
    normalized.includes("mwa")
  ) {
    return "mwa";
  }
  return "extension";
}

function isUsableWalletReadyState(readyState: SvmWalletReadyState): boolean {
  return readyState === "Installed" || readyState === "Loadable";
}

function walletPriority(name: string): number {
  const normalized = name.toLowerCase();
  if (normalized.includes("phantom")) return 0;
  if (normalized.includes("solflare")) return 1;
  if (normalized.includes("backpack")) return 2;
  if (normalized.includes("glow")) return 3;
  return 10;
}

function pickPreferredSvmWallet(wallet: SafeSvmWalletState) {
  return [...wallet.wallets]
    .filter((candidate) => isUsableWalletReadyState(candidate.readyState))
    .sort((left, right) => {
      const installedDelta =
        Number(left.readyState === "Installed") -
        Number(right.readyState === "Installed");
      if (installedDelta !== 0) {
        return -installedDelta;
      }
      return (
        walletPriority(left.adapter.name) - walletPriority(right.adapter.name)
      );
    })[0];
}

export type SvmConnectAttempt =
  | { status: "connected" }
  | { status: "unavailable" }
  | {
      status: "selecting";
      walletName: string;
    };

export async function connectPreferredSvmWallet(
  wallet: SafeSvmWalletState,
): Promise<SvmConnectAttempt> {
  if (wallet.publicKey || wallet.connected) {
    return { status: "connected" };
  }

  if (!wallet.select || !wallet.connect) {
    return { status: "unavailable" };
  }

  if (wallet.walletName) {
    await wallet.connect();
    return { status: "connected" };
  }

  const selectedWallet = pickPreferredSvmWallet(wallet);
  if (!selectedWallet) {
    return { status: "unavailable" };
  }

  wallet.select(selectedWallet.adapter.name as SvmWalletName);
  return { status: "selecting", walletName: selectedWallet.adapter.name };
}

export async function executeSvmWalletConnect({
  getCurrent,
  walletName,
  waitForAutoConnect = () =>
    new Promise<void>((resolve) =>
      setTimeout(resolve, SVM_AUTOCONNECT_GRACE_MS),
    ),
}: {
  getCurrent: () => SafeSvmWalletState;
  walletName: string;
  waitForAutoConnect?: () => Promise<void>;
}): Promise<void> {
  const current = getCurrent();
  if (current.publicKey && current.walletName === walletName) return;
  if (current.walletName !== walletName) {
    current.select?.(walletName as SvmWalletName);
  }
  if (!current.connect) return;

  // WalletProvider's autoConnect reacts to select(). Give it the first chance
  // to connect, then invoke connect() only when no automatic attempt started.
  // Calling both concurrently makes Phantom reject with WalletConnectionError.
  await waitForAutoConnect();
  const selected = getCurrent();
  if (selected.publicKey || selected.connected || selected.connecting) return;
  // A newer picker action owns a different adapter now. Let that request
  // connect it instead of allowing this stale grace timer to race it.
  if (selected.walletName && selected.walletName !== walletName) return;
  await selected.connect?.();
}

export function getSvmCapabilitySnapshot(
  wallet: SafeSvmWalletState | undefined,
) {
  if (!wallet?.publicKey) {
    return undefined;
  }
  return {
    canSignMessage: Boolean(wallet.signMessage),
    canSignTransaction: Boolean(wallet.signTransaction),
    canSignAllTransactions: Boolean(wallet.signAllTransactions),
    canSendTransaction: Boolean(wallet.sendTransaction),
    canSignAndSendTransaction: Boolean(wallet.sendTransaction),
  };
}

function buildSvmWalletDescriptors(
  wallet: SafeSvmWalletState,
): SvmWalletDescriptor[] {
  return wallet.wallets
    .filter((entry) =>
      SVM_WALLET_ALLOWLIST.has(canonicalWalletKey(entry.adapter.name)),
    )
    .map((entry) => ({
      name: entry.adapter.name,
      installed: entry.readyState === "Installed",
      ready:
        entry.readyState === "Installed" || entry.readyState === "Loadable",
    }));
}

function toSvmWalletOption(descriptor: SvmWalletDescriptor): AomiWalletOption {
  return {
    id: descriptor.name,
    label: descriptor.name,
    family: "svm",
    kind: "solana",
    status: descriptor.ready
      ? descriptor.installed
        ? "installed"
        : "available"
      : "unavailable",
    installed: descriptor.installed,
    ready: descriptor.ready,
  };
}

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export function useSvmWalletRuntime({
  preferDirectSend = true,
  registryStore,
  selectedNetwork,
  supportedNetworks,
  setSelectedNetworkId,
  wallet: walletOverride,
}: {
  preferDirectSend?: boolean;
  registryStore: WalletRegistryStore;
  selectedNetwork?: SvmNetworkOption;
  supportedNetworks: readonly SvmNetworkOption[];
  setSelectedNetworkId: (id: string) => void;
  wallet?: SafeSvmWalletState;
}): SvmWalletRuntime {
  const wallet = walletOverride ?? DISCONNECTED_SVM_WALLET;
  const walletRef = useLatestRef(wallet);

  useSvmRegistrySource(registryStore, { svmWallet: wallet });

  const settleConnect = useCallback(
    (walletName: string) => {
      registryStore.dispatch({
        type: "svm/connect-settled",
        walletName,
        now: Date.now(),
      });
    },
    [registryStore],
  );

  const executeConnect = useCallback(
    async (walletName: string) => {
      try {
        await executeSvmWalletConnect({
          getCurrent: () => walletRef.current,
          walletName,
        });
      } finally {
        settleConnect(walletName);
      }
    },
    [settleConnect, walletRef],
  );

  const executeDisconnect = useCallback(async () => {
    const current = walletRef.current;
    if (!current.publicKey || !current.disconnect) return;
    await current.disconnect();
  }, [walletRef]);

  useEffect(() => {
    registryStore.updateExecutors({
      svmConnect: executeConnect,
      svmDisconnect: executeDisconnect,
    });
  }, [executeConnect, executeDisconnect, registryStore]);

  const connect = useCallback(
    async (optionId?: string) => {
      if (
        (wallet.publicKey || wallet.connected) &&
        (!optionId || optionId === wallet.walletName)
      ) {
        return;
      }
      const walletName =
        optionId ?? pickPreferredSvmWallet(wallet)?.adapter.name;
      if (!walletName) return;
      registryStore.dispatch({
        type: "svm/connect-requested",
        walletName,
        now: Date.now(),
      });
    },
    [registryStore, wallet],
  );

  const disconnect = useCallback(async () => {
    registryStore.dispatch({
      type: "user/disconnect-family",
      family: "svm",
      now: Date.now(),
    });
  }, [registryStore]);

  const selectAccount = useCallback(
    async (accountId: string) => {
      const account = selectAccounts(
        registryStore.getSnapshot(),
        "svm",
        Date.now(),
      ).find((candidate) => candidate.id === accountId);
      if (!account) return;
      registryStore.dispatch({
        type: "user/select-active",
        family: "svm",
        address: account.address,
        uid: account.id,
        stableId: account.id,
        now: Date.now(),
      });
    },
    [registryStore],
  );

  const selectNetwork = useCallback(
    async (networkId: string | number) => {
      const id = String(networkId);
      if (selectedNetwork?.id === id) return;
      if (wallet.publicKey && wallet.disconnect) {
        await wallet.disconnect();
      }
      setSelectedNetworkId(id);
    },
    [selectedNetwork?.id, setSelectedNetworkId, wallet],
  );

  const config = useMemo(
    () => ({
      rpcHttpUrl:
        selectedNetwork?.rpcHttpUrl ??
        DEFAULT_SVM_RPC_HTTP_URLS[
          selectedNetwork?.cluster ?? DEFAULT_SVM_CLUSTER
        ],
      rpcWsUrl: selectedNetwork?.rpcWsUrl,
      preferDirectSend,
    }),
    [preferDirectSend, selectedNetwork],
  );
  const execution = useMemo(
    () => buildSvmTransactionMethods(wallet, config),
    [config, wallet],
  );
  const options = useMemo(
    () => buildSvmWalletDescriptors(wallet).map(toSvmWalletOption),
    [wallet],
  );
  const accounts = useCallback(
    (now: number) => selectAccounts(registryStore.getSnapshot(), "svm", now),
    [registryStore],
  );
  const identity = useCallback(
    (now: number) => {
      const registryIdentity = selectSvmIdentity(
        registryStore.getSnapshot(),
        now,
      );
      return {
        ...registryIdentity,
        cluster: selectedNetwork?.cluster ?? DEFAULT_SVM_CLUSTER,
        walletSource: registryIdentity.address
          ? wallet.transport === "embedded"
            ? ("embedded" as const)
            : ("injected" as const)
          : undefined,
        transport: registryIdentity.address
          ? (wallet.transport ??
            detectSvmTransport(registryIdentity.walletName))
          : undefined,
        capabilities: getSvmCapabilitySnapshot(wallet),
      };
    },
    [registryStore, selectedNetwork?.cluster, wallet],
  );

  return {
    status:
      wallet.select || wallet.connect || wallet.publicKey
        ? "ready"
        : "unavailable",
    registryStore,
    identity,
    accounts,
    activeAccount: accounts(Date.now()).find((account) => account.active),
    options,
    supportedNetworks,
    selectedNetwork,
    connect,
    disconnect,
    selectAccount,
    selectNetwork,
    execution,
  };
}
