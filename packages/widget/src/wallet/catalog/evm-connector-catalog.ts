"use client";

import type { Chain, Transport } from "viem";
import { http } from "viem";
import {
  createConfig,
  createStorage,
  type Config,
  type CreateConnectorFn,
} from "wagmi";
import {
  baseAccount,
  coinbaseWallet,
  injected,
  walletConnect,
} from "wagmi/connectors";
import type { EvmWalletId, EvmWalletPreset } from "./wallet-ids";
import { EVM_PRESETS } from "./wallet-ids";
import { safeEnv } from "../env";

export const AOMI_DEFAULT_WC_PROJECT_ID =
  safeEnv(() => process.env.NEXT_PUBLIC_AOMI_WC_PROJECT_ID) ??
  safeEnv(() => process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID) ??
  safeEnv(() => process.env.NEXT_PUBLIC_PROJECT_ID);

const evmConfigCache = new Map<string, Config>();

export type ResolvedEvmWalletsConfig = {
  chains: readonly [Chain, ...Chain[]];
  preset?: EvmWalletPreset;
  wallets?: readonly EvmWalletId[];
  connectors?: readonly CreateConnectorFn[];
  walletConnectProjectId?: string;
  coinbase?: boolean;
  appName?: string;
  appLogoUrl?: string | null;
  transports?: Record<number, Transport>;
  ssr?: boolean;
  includeBaseAccount?: boolean;
  persistConnections?: boolean;
};

function defaultHttpTransports(
  chains: readonly Chain[],
): Record<number, Transport> {
  return Object.fromEntries(
    chains.map((chain) => [chain.id, http(chain.rpcUrls.default.http[0])]),
  );
}

function connectorLooksLikeWalletConnect(
  connector: CreateConnectorFn,
): boolean {
  const meta = connector as unknown as {
    id?: string;
    name?: string;
    type?: string;
  };
  const text = [meta.id, meta.name, meta.type].filter(Boolean).join(" ");
  return /wallet\s*connect|walletconnect/i.test(text);
}

function warnDuplicateWalletConnect(): void {
  if (safeEnv(() => process.env.NODE_ENV) === "production") return;
  console.warn(
    "[aomi-wallet-kit] wallets.evm.connectors included a WalletConnect-like connector. Aomi owns the WalletConnect connector; pass walletConnectProjectId instead.",
  );
}

function memoryStringStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

export function createAomiEvmConfig(input: ResolvedEvmWalletsConfig): Config {
  const wanted = new Set(
    input.wallets ?? EVM_PRESETS[input.preset ?? "popular"],
  );
  const wcProjectId =
    input.walletConnectProjectId ?? AOMI_DEFAULT_WC_PROJECT_ID;
  const hostConnectors = (input.connectors ?? []).filter((connector) => {
    if (!connectorLooksLikeWalletConnect(connector)) return true;
    warnDuplicateWalletConnect();
    return false;
  });
  const cacheKey = evmConfigCacheKey(input, wanted, wcProjectId);
  if (cacheKey) {
    const cached = evmConfigCache.get(cacheKey);
    if (cached) return cached;
  }

  const connectors: CreateConnectorFn[] = [
    injected({ shimDisconnect: true }),
    ...(wanted.has("walletconnect") && wcProjectId
      ? [walletConnect({ projectId: wcProjectId, showQrModal: true })]
      : []),
    ...(input.coinbase !== false && wanted.has("coinbase")
      ? [
          coinbaseWallet({
            appName: input.appName ?? "Aomi",
            appLogoUrl: input.appLogoUrl ?? undefined,
          }),
        ]
      : []),
    ...(wanted.has("baseAccount") || input.includeBaseAccount
      ? [
          baseAccount({
            appName: input.appName ?? "Aomi",
            appLogoUrl: input.appLogoUrl ?? null,
            paymasterUrls: {},
          }),
        ]
      : []),
    ...hostConnectors,
  ];

  const config = createConfig({
    chains: input.chains,
    connectors,
    transports: input.transports ?? defaultHttpTransports(input.chains),
    multiInjectedProviderDiscovery: true,
    ssr: input.ssr ?? true,
    // Non-persistent mode still needs a real storage object: WagmiProvider
    // unconditionally calls the persister's rehydrate hook, and `storage: null`
    // leaves it undefined (uncaught error on mount). Memory-backed storage
    // keeps hydration working while nothing survives a reload.
    storage:
      input.persistConnections === false
        ? createStorage({ storage: memoryStringStorage() })
        : undefined,
  });
  if (cacheKey) {
    evmConfigCache.set(cacheKey, config);
    if (evmConfigCache.size > 8) {
      const firstKey = evmConfigCache.keys().next().value;
      if (firstKey) evmConfigCache.delete(firstKey);
    }
  }
  return config;
}

export { EVM_PRESETS };

function evmConfigCacheKey(
  input: ResolvedEvmWalletsConfig,
  wanted: ReadonlySet<EvmWalletId>,
  wcProjectId: string | undefined,
): string | null {
  if (input.connectors?.length || input.transports) return null;
  return JSON.stringify({
    chains: input.chains.map((chain) => [
      chain.id,
      chain.rpcUrls.default.http[0],
    ]),
    wallets: [...wanted].sort(),
    walletConnectProjectId: wcProjectId ?? null,
    coinbase: input.coinbase !== false,
    appName: input.appName ?? null,
    appLogoUrl: input.appLogoUrl ?? null,
    ssr: input.ssr ?? true,
    includeBaseAccount: input.includeBaseAccount ?? false,
    persistConnections: input.persistConnections !== false,
  });
}
