"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Chain } from "viem";
import type { AomiNetworkTarget, SvmNetworkOption } from "./types";
import { resolveSelectedSvmNetwork } from "./catalog/svm-networks";

type WalletNetworkPreferences = {
  selectedEvmChainId?: number;
  selectedSolanaNetworkId?: string;
};

const STORAGE_PREFIX = "aomi.wallet-preferences";

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}.${key}`;
}

function loadWalletNetworkPreferences(key: string): WalletNetworkPreferences {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(key));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const stored = parsed as WalletNetworkPreferences;
    return {
      selectedEvmChainId:
        typeof stored.selectedEvmChainId === "number"
          ? stored.selectedEvmChainId
          : undefined,
      selectedSolanaNetworkId:
        typeof stored.selectedSolanaNetworkId === "string"
          ? stored.selectedSolanaNetworkId
          : undefined,
    };
  } catch {
    return {};
  }
}

function saveWalletNetworkPreferences(
  key: string,
  prefs: WalletNetworkPreferences,
): void {
  try {
    globalThis.localStorage?.setItem(storageKey(key), JSON.stringify(prefs));
  } catch {
    // localStorage unavailable or over quota — preferences are best-effort.
  }
}

type NetworkPreferencesContextValue = {
  selectedEvmChainId?: number;
  selectedSolanaNetworkId?: string;
  supportedEvmChains: readonly Chain[];
  supportedSolanaNetworks: readonly SvmNetworkOption[];
  selectedSolanaNetwork?: SvmNetworkOption;
  setSelectedEvmChainId: (chainId: number | undefined) => void;
  setSelectedSolanaNetworkId: (networkId: string | undefined) => void;
  selectTarget: (target: AomiNetworkTarget) => void;
};

const NetworkPreferencesContext =
  createContext<NetworkPreferencesContextValue | null>(null);

export function AomiWalletNetworkPreferencesProvider({
  children,
  evmChains,
  solanaNetworks,
  storageKey = "default",
}: {
  children: ReactNode;
  evmChains: readonly Chain[];
  solanaNetworks: readonly SvmNetworkOption[];
  storageKey?: string | null;
}) {
  const [persisted] = useState(() =>
    storageKey ? loadWalletNetworkPreferences(storageKey) : {},
  );

  const [selectedEvmChainId, setSelectedEvmChainId] = useState<
    number | undefined
  >(() =>
    persisted.selectedEvmChainId !== undefined &&
    evmChains.some((chain) => chain.id === persisted.selectedEvmChainId)
      ? persisted.selectedEvmChainId
      : evmChains[0]?.id,
  );
  const [selectedSolanaNetworkId, setSelectedSolanaNetworkId] = useState<
    string | undefined
  >(() =>
    persisted.selectedSolanaNetworkId &&
    solanaNetworks.some((n) => n.id === persisted.selectedSolanaNetworkId)
      ? persisted.selectedSolanaNetworkId
      : resolveSelectedSvmNetwork(solanaNetworks)?.id,
  );

  useEffect(() => {
    if (!evmChains.length) {
      setSelectedEvmChainId(undefined);
      return;
    }
    setSelectedEvmChainId((current) =>
      evmChains.some((chain) => chain.id === current)
        ? current
        : evmChains[0]?.id,
    );
  }, [evmChains]);

  useEffect(() => {
    if (!solanaNetworks.length) {
      setSelectedSolanaNetworkId(undefined);
      return;
    }
    setSelectedSolanaNetworkId((current) =>
      solanaNetworks.some((network) => network.id === current)
        ? current
        : resolveSelectedSvmNetwork(solanaNetworks)?.id,
    );
  }, [evmChains.length, solanaNetworks]);

  useEffect(() => {
    if (!storageKey) return;
    saveWalletNetworkPreferences(storageKey, {
      selectedEvmChainId,
      selectedSolanaNetworkId,
    });
  }, [storageKey, selectedEvmChainId, selectedSolanaNetworkId]);

  const selectedSolanaNetwork = useMemo(
    () =>
      solanaNetworks.length
        ? resolveSelectedSvmNetwork(solanaNetworks, selectedSolanaNetworkId)
        : undefined,
    [selectedSolanaNetworkId, solanaNetworks],
  );

  const value = useMemo<NetworkPreferencesContextValue>(
    () => ({
      selectedEvmChainId,
      selectedSolanaNetworkId,
      supportedEvmChains: evmChains,
      supportedSolanaNetworks: solanaNetworks,
      selectedSolanaNetwork,
      setSelectedEvmChainId,
      setSelectedSolanaNetworkId,
      selectTarget: (target: AomiNetworkTarget) => {
        if (target.family === "evm") {
          setSelectedEvmChainId(target.chainId);
          return;
        }
        setSelectedSolanaNetworkId(target.networkId);
      },
    }),
    [
      evmChains,
      selectedEvmChainId,
      selectedSolanaNetwork,
      selectedSolanaNetworkId,
      solanaNetworks,
    ],
  );

  return (
    <NetworkPreferencesContext.Provider value={value}>
      {children}
    </NetworkPreferencesContext.Provider>
  );
}

export function useAomiWalletNetworkPreferences(): NetworkPreferencesContextValue {
  const context = useContext(NetworkPreferencesContext);
  if (!context) {
    throw new Error(
      "useAomiWalletNetworkPreferences must be used within AomiWalletNetworkPreferencesProvider",
    );
  }
  return context;
}

/**
 * Non-throwing variant for components that may render without a wallet
 * provider in the tree — e.g. a standalone <AomiFrame /> on a docs page or
 * during SSR/prerender, where no wallet kit provider mounts the network
 * preferences context. Returns null when the provider is absent so callers
 * can degrade gracefully instead of crashing the render.
 */
export function useOptionalAomiWalletNetworkPreferences(): NetworkPreferencesContextValue | null {
  return useContext(NetworkPreferencesContext);
}
