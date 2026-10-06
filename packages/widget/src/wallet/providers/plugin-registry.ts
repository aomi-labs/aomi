"use client";

import type { ReactNode } from "react";
import type {
  AccountConfig,
  AuthConfig,
  AomiWalletKitProviderInput,
  AomiWalletKitProviderProps,
  ExecutionConfig,
  ProvidersConfig,
} from "@/wallet/config/types";
import type { SvmNetworkOption } from "@/wallet/types";
import type { Chain } from "viem";
import type { ResolvedEvmWalletsConfig } from "@/wallet/catalog/evm-connector-catalog";
import { loadParaPlugin, loadPrivyPlugin } from "./sdk-loaders";
import type { SafeSvmWalletState } from "@/wallet/runtime/svm/wallet-runtime";

/**
 * A wallet provider plugin. Knows how to render itself from the normalized
 * capability config, and optionally how to recognize its ergonomic sugar form.
 * Registering one lets `AomiWalletKitProvider` resolve a provider by id instead
 * of branching on hardcoded provider names — adding a provider is a
 * `registerWalletProvider(...)` call, not a new `if` in the router.
 *
 */
export type WalletProviderPlugin = {
  id: string;
  authMode?: "additive" | "full";
  /** Loads the SDK-backed plugin; absent once the plugin itself is registered. */
  load?: () => Promise<WalletProviderPlugin>;
  wrap?: (props: {
    auth?: AuthConfig;
    children: ReactNode;
    providers?: ProvidersConfig;
  }) => ReactNode;
  isAvailable?: (props: {
    auth?: AuthConfig;
    providers?: ProvidersConfig;
  }) => boolean;
  renderEvmRuntimeProvider?: (props: {
    children: ReactNode;
    config: ResolvedEvmWalletsConfig;
  }) => ReactNode;
  renderComposer?: (props: {
    account?: AccountConfig;
    auth?: AuthConfig;
    children: ReactNode;
    execution?: ExecutionConfig;
    externalSvmWallet: SafeSvmWalletState;
    providers?: ProvidersConfig;
    solanaRuntimeConfig?: {
      cluster: SvmNetworkOption["cluster"];
      rpcHttpUrl: string;
      rpcWsUrl?: string;
      preferDirectSend: boolean;
    };
    supportedChains: readonly Chain[];
    supportedSolanaNetworks: readonly SvmNetworkOption[];
    selectedSolanaNetwork?: SvmNetworkOption;
    setSelectedSolanaNetworkId: (networkId: string) => void;
  }) => ReactNode;
  detectSugar?: (
    input: AomiWalletKitProviderInput,
  ) => AomiWalletKitProviderProps | null;
};

/** Retry after a failed load instead of caching the rejection. */
function loadOnce(
  load: () => Promise<WalletProviderPlugin>,
): () => Promise<WalletProviderPlugin> {
  let loading: Promise<WalletProviderPlugin> | undefined;
  return () =>
    (loading ??= load().catch((error) => {
      loading = undefined;
      throw error;
    }));
}

// Privy and Para load on demand when `auth` selects them; their eager entry
// points replace these with plugins that need no load.
const registry = new Map<string, WalletProviderPlugin>([
  [
    "privy",
    { id: "privy", authMode: "additive", load: loadOnce(loadPrivyPlugin) },
  ],
  [
    "para",
    { id: "para", authMode: "additive", load: loadOnce(loadParaPlugin) },
  ],
]);

export function registerWalletProvider(plugin: WalletProviderPlugin): void {
  registry.set(plugin.id, plugin);
}

export function getWalletProvider(
  id: string,
): WalletProviderPlugin | undefined {
  return registry.get(id);
}

/**
 * Run each registered plugin's sugar detector in registration order; the first
 * match wins. Replaces the previous isParaSugar/isPrivySugar chain without the
 * router naming a provider.
 */
export function detectProviderSugar(
  input: AomiWalletKitProviderInput,
): AomiWalletKitProviderProps | null {
  for (const plugin of registry.values()) {
    const normalized = plugin.detectSugar?.(input);
    if (normalized) return normalized;
  }
  return null;
}

/** Hover or focus can warm a provider SDK without changing account state. */
export async function preloadWalletProvider(id: string): Promise<void> {
  await getWalletProvider(id)?.load?.();
}
