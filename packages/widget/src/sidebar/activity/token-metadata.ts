"use client";
import { useEffect, useState } from "react";
import { createPublicClient, erc20Abi, http, isAddress } from "viem";
import type { SupportedChain } from "./presentation";

export type TokenMetadata = {
  symbol?: string;
  name?: string;
  decimals?: number;
};
const cache = new Map<
  string,
  { expires: number; promise: Promise<TokenMetadata> }
>();

/** Read from the configured transaction chain; never infer identity from a label. */
export function readTokenMetadata(
  chain: SupportedChain,
  address: string,
): Promise<TokenMetadata> {
  const url = chain.rpcUrls?.default.http[0];
  if (!url || !isAddress(address)) return Promise.resolve({});
  const key = `${chain.id}:${url}:${address.toLowerCase()}`;
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.promise;
  const client = createPublicClient({
    transport: http(url, { timeout: 6000, retryCount: 0 }),
  });
  const promise = Promise.allSettled([
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address, abi: erc20Abi, functionName: "name" }),
  ]).then(([symbol, decimals, name]) => ({
    symbol:
      symbol.status === "fulfilled" && symbol.value.trim()
        ? symbol.value.trim().slice(0, 80)
        : undefined,
    decimals:
      decimals.status === "fulfilled" &&
      Number.isInteger(decimals.value) &&
      decimals.value >= 0 &&
      decimals.value <= 255
        ? decimals.value
        : undefined,
    name:
      name.status === "fulfilled" && name.value.trim()
        ? name.value.trim().slice(0, 160)
        : undefined,
  }));
  cache.set(key, { expires: Date.now() + 60_000, promise });
  return promise;
}

export function useTokenMetadata(
  chain: SupportedChain | undefined,
  address: string,
  enabled: boolean,
) {
  const key =
    enabled && chain
      ? `${chain.id}:${chain.rpcUrls?.default.http[0]}:${address.toLowerCase()}`
      : "";
  const [resolved, setResolved] = useState<{
    key: string;
    value: TokenMetadata;
  }>();
  useEffect(() => {
    if (!key || !chain) return;
    let active = true;
    void readTokenMetadata(chain, address).then((value) => {
      if (active) setResolved({ key, value });
    });
    return () => {
      active = false;
    };
  }, [key, chain, address]);
  return {
    metadata: resolved?.key === key ? resolved.value : undefined,
    loading: Boolean(key && resolved?.key !== key),
  };
}
