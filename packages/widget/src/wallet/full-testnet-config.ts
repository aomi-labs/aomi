"use client";

import { useMemo } from "react";
import type { Chain } from "viem";
import { safeEnv } from "./env";

const FULL_TESTNET_ENABLED =
  safeEnv(() => process.env.NEXT_PUBLIC_USE_FULL_TESTNET) === "true";
const FULL_TESTNET_RPC_MAP_RAW =
  safeEnv(() => process.env.NEXT_PUBLIC_FULL_TESTNET_RPC_MAP)?.trim() ?? "";

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

const FULL_TESTNET_RPC_OVERRIDES = parseRpcOverrides(FULL_TESTNET_RPC_MAP_RAW);

export function isFullTestnet(): boolean {
  return (
    FULL_TESTNET_ENABLED && Object.keys(FULL_TESTNET_RPC_OVERRIDES).length > 0
  );
}

export function useFullTestnet<T extends readonly [Chain, ...Chain[]]>(
  chains: T,
) {
  return useMemo(() => {
    const enabled = isFullTestnet();
    const routedChains = (enabled
      ? chains.map((chain) => {
          const rpcUrl = FULL_TESTNET_RPC_OVERRIDES[chain.id];
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
        Object.keys(FULL_TESTNET_RPC_OVERRIDES).map(Number),
      ) as ReadonlySet<number>,
    };
  }, [chains]);
}
