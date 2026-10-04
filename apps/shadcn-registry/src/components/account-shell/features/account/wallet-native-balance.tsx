"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress } from "viem";
import { useAomiWalletKit } from "../../../../lib/wallet-kit/context";
import type { ManagedWallet } from "./wallet-management-model";

export type NativeBalanceTarget = {
  family: "evm" | "svm";
  address: string;
  rpcUrl: string;
  network: string;
  symbol: string;
  decimals: number;
};

/** Read only the configured network's native currency; no signer is invoked. */
export async function readNativeBalance(
  target: NativeBalanceTarget,
): Promise<string> {
  if (target.family === "evm" && !isAddress(target.address))
    throw new Error("Invalid address");
  const response = await fetch(target.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: target.family === "evm" ? "eth_getBalance" : "getBalance",
      params:
        target.family === "evm"
          ? [target.address, "latest"]
          : [target.address, { commitment: "confirmed" }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Balance unavailable");
  const body: { result?: unknown; error?: unknown } = await response.json();
  if (body.error) throw new Error("Balance unavailable");
  let amount: bigint;
  if (target.family === "evm") {
    if (typeof body.result !== "string" || !/^0x[0-9a-f]+$/i.test(body.result))
      throw new Error("Invalid balance response");
    amount = BigInt(body.result);
  } else {
    const value =
      body.result && typeof body.result === "object" && "value" in body.result
        ? body.result.value
        : undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      throw new Error("Invalid balance response");
    amount = BigInt(value);
  }
  return formatUnits(amount, target.decimals);
}

const cache = new Map<
  string,
  { value?: string; updatedAt?: number; inflight?: Promise<string> }
>();

export function WalletNativeBalance({ wallet }: { wallet: ManagedWallet }) {
  const adapter = useAomiWalletKit();
  const target = useMemo<NativeBalanceTarget | null>(() => {
    if (wallet.family === "evm") {
      const chainId =
        wallet.chainId ??
        (wallet.operating ? adapter.identity.chainId : undefined);
      const chain = (
        adapter.supportedNetworks?.evm ??
        adapter.supportedChains ??
        []
      ).find((candidate) => candidate.id === chainId);
      const rpcUrl = chain?.rpcUrls.default.http[0];
      return chain && rpcUrl
        ? {
            family: "evm",
            address: wallet.address,
            rpcUrl,
            network: chain.name,
            symbol: chain.nativeCurrency.symbol,
            decimals: chain.nativeCurrency.decimals,
          }
        : null;
    }
    const network = adapter.selectedSolanaNetwork;
    return network
      ? {
          family: "svm",
          address: wallet.address,
          rpcUrl: network.rpcHttpUrl,
          network: `Solana ${network.label}`,
          symbol: "SOL",
          decimals: 9,
        }
      : null;
  }, [
    adapter.identity.chainId,
    adapter.selectedSolanaNetwork,
    adapter.supportedChains,
    adapter.supportedNetworks,
    wallet.address,
    wallet.chainId,
    wallet.family,
    wallet.operating,
  ]);
  const key = target ? JSON.stringify(target) : "";
  const [snapshot, setSnapshot] = useState<{
    key: string;
    value?: string;
    status: "loading" | "ready" | "error";
  }>({ key, status: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!key) return;
    const requestedTarget: NativeBalanceTarget = JSON.parse(key);
    let mounted = true;
    const entry = cache.get(key) ?? {};
    cache.set(key, entry);
    if (!retry && entry.updatedAt && Date.now() - entry.updatedAt < 60_000) {
      setSnapshot({ key, value: entry.value, status: "ready" });
      return;
    }
    setSnapshot({ key, value: entry.value, status: "loading" });
    const promise = entry.inflight ?? readNativeBalance(requestedTarget);
    entry.inflight = promise;
    void promise
      .then((value) => {
        entry.value = value;
        entry.updatedAt = Date.now();
        if (mounted) setSnapshot({ key, value, status: "ready" });
      })
      .catch(() => {
        if (mounted) setSnapshot({ key, value: entry.value, status: "error" });
      })
      .finally(() => {
        if (entry.inflight === promise) entry.inflight = undefined;
      });
    return () => {
      mounted = false;
    };
  }, [key, retry]);

  if (!target)
    return (
      <span className="type-meta text-aomi-muted">
        Balance unavailable · network not specified
      </span>
    );
  const current =
    snapshot.key === key
      ? snapshot
      : { status: "loading" as const, value: undefined };
  const value =
    current.value === undefined
      ? undefined
      : Number(current.value).toLocaleString(undefined, {
          maximumFractionDigits: 6,
        });
  return (
    <span
      className="type-meta text-aomi-muted flex flex-wrap items-center gap-x-2"
      role="status"
    >
      <span>
        {value !== undefined
          ? `${value === "0" && current.value !== "0" ? "<0.000001" : value} ${target.symbol}`
          : current.status === "error"
            ? "Balance unavailable"
            : "Loading balance…"}{" "}
        · {target.network}
        {current.value !== undefined && current.status !== "ready"
          ? current.status === "error"
            ? " · last known"
            : " · refreshing"
          : ""}
      </span>
      {current.status !== "loading" ? (
        <button
          type="button"
          className="hover:text-aomi-fg underline underline-offset-2"
          aria-label={`Refresh balance for ${wallet.address}`}
          onClick={() => setRetry((value) => value + 1)}
        >
          {current.status === "error" ? "Retry" : "Refresh"}
        </button>
      ) : null}
    </span>
  );
}
