"use client";

import { createContext, useContext, useMemo } from "react";
import type { Chain } from "viem";

export type FullTestnetConfig = { rpcMap: Record<number, string> };
export const FullTestnetConfigContext = createContext<
  FullTestnetConfig | undefined
>(undefined);
const EMPTY_OVERRIDES: Record<number, string> = {};

export function parseRpcOverrides(raw: string): Record<number, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const overrides: Record<number, string> = {};
  const writeOverride = (chainIdRaw: string, rpcUrlRaw: string) => {
    const chainId = Number(chainIdRaw.trim());
    const rpcUrl = rpcUrlRaw.trim();
    if (!Number.isInteger(chainId) || chainId <= 0 || !rpcUrl) return;

    try {
      overrides[chainId] = new URL(rpcUrl).toString();
    } catch {
      // Ignore malformed URLs so one bad env entry does not break the app.
    }
  };

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      for (const [chainId, rpcUrl] of Object.entries(parsed ?? {})) {
        if (typeof rpcUrl === "string") {
          writeOverride(chainId, rpcUrl);
        }
      }
    } catch {
      return {};
    }
    return overrides;
  }

  for (const part of trimmed.split(",")) {
    const [chainId, ...rpcUrlParts] = part.split("=");
    if (!chainId || rpcUrlParts.length === 0) continue;
    writeOverride(chainId, rpcUrlParts.join("="));
  }

  return overrides;
}

/** Hosts explicitly opt into their disposable RPC map. */
export function isFullTestnet(config?: FullTestnetConfig): boolean {
  return Boolean(config && Object.keys(config.rpcMap).length);
}

export function useFullTestnet<T extends readonly [Chain, ...Chain[]]>(
  chains: T,
  config?: FullTestnetConfig,
) {
  const inherited = useContext(FullTestnetConfigContext);
  const overrides = (config ?? inherited)?.rpcMap ?? EMPTY_OVERRIDES;
  return useMemo(() => {
    const enabled = Object.keys(overrides).length > 0;
    const routedChains = (enabled
      ? chains.map((chain) => {
          const rpcUrl = overrides[chain.id];
          if (!rpcUrl) return chain;

          return {
            ...chain,
            rpcUrls: {
              ...chain.rpcUrls,
              default: {
                ...chain.rpcUrls.default,
                http: [rpcUrl],
              },
              public: chain.rpcUrls.public
                ? {
                    ...chain.rpcUrls.public,
                    http: [rpcUrl],
                  }
                : {
                    http: [rpcUrl],
                  },
            },
          };
        })
      : chains) as unknown as T;

    return {
      enabled,
      routedChains,
      routedChainIds: new Set(
        Object.keys(overrides).map(Number),
      ) as ReadonlySet<number>,
    };
  }, [chains, overrides]);
}
