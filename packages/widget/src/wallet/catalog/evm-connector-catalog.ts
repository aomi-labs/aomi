"use client";

import type { Chain, Transport } from "viem";
import { http } from "viem";
import {
  createConfig,
  createStorage,
  ProviderNotFoundError,
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

/** @deprecated Pass wallets.evm.walletConnectProjectId explicitly. */
export const AOMI_DEFAULT_WC_PROJECT_ID: string | undefined = undefined;

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

/**
 * Point each chain's default RPC at the host's own endpoint. Chains without
 * an entry keep viem's public default (e.g. eth.merkle.io for mainnet), which
 * is rate-limited and shared. Config caches key on the resulting URLs.
 */
export function withRpcUrls<T extends readonly [Chain, ...Chain[]]>(
  chains: T,
  rpcUrls?: Readonly<Record<number, string>>,
  keep?: ReadonlySet<number>,
): T {
  if (!rpcUrls || Object.keys(rpcUrls).length === 0) return chains;
  return chains.map((chain) => {
    const url = rpcUrls[chain.id]?.trim();
    if (!url || keep?.has(chain.id)) return chain;
    return {
      ...chain,
      rpcUrls: {
        ...chain.rpcUrls,
        default: { ...chain.rpcUrls.default, http: [url] },
      },
    };
  }) as unknown as T;
}

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

type StoredConnection = { connector?: { id?: string } };

async function hasStoredConnection(
  storage: Config["storage"],
  connectorId: string,
): Promise<boolean> {
  try {
    if ((await storage?.getItem("recentConnectorId")) === connectorId)
      return true;
    const stored = (await storage?.getItem("store")) as {
      state?: { connections?: Map<string, StoredConnection> };
    } | null;
    return [...(stored?.state?.connections?.values() ?? [])].some(
      (connection) => connection.connector?.id === connectorId,
    );
  } catch {
    return false;
  }
}

/**
 * WalletConnect's provider and QR modal are large lazy imports, and wagmi's
 * setup and mount-time reconnect ask every connector for its provider. Keep
 * them unloaded until the user picks WalletConnect or a stored session needs
 * restoring, so guests never download them on first load.
 */
function deferredWalletConnect(
  parameters: Parameters<typeof walletConnect>[0],
): CreateConnectorFn {
  const create = walletConnect(parameters);
  return ((config) => {
    const connector = create(config);
    let awake = false;
    return {
      ...connector,
      async connect(this: typeof connector, options) {
        awake = true;
        return connector.connect.call(this, options);
      },
      async getProvider(this: typeof connector, options) {
        if (!awake) {
          awake = await hasStoredConnection(
            config.storage ?? null,
            connector.id,
          );
          if (!awake) throw new ProviderNotFoundError();
          // setup() skipped its listeners while asleep.
          void connector.setup?.call(this);
        }
        return connector.getProvider.call(this, options);
      },
    } as typeof connector;
  }) as CreateConnectorFn;
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
      ? [deferredWalletConnect({ projectId: wcProjectId, showQrModal: true })]
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
