"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { getWalletClient } from "wagmi/actions";
import {
  useCapabilities,
  useConfig,
  useConnections,
  useSendCallsSync,
  useWalletClient,
} from "wagmi";
import type { Connector } from "wagmi";
import type { executeWalletCalls } from "@aomi-labs/react";
import { normalizeAtomicCapabilities } from "@/wallet/execution/wallet-execution";
import { walletDebug } from "@/wallet/wallet-debug";
import { canonicalWalletKey } from "@/wallet/catalog/wallet-branding";

// The wallet runtime always renders under a WagmiProvider, so these hooks call
// wagmi directly; they only reshape wagmi's data for the registry.

type ExecutorArgs = Parameters<typeof executeWalletCalls>[0];
export type WalletClient = ReturnType<typeof useWalletClient>["data"];
export type WalletCapabilities = ExecutorArgs["capabilities"];
export type SendCallsSync = ExecutorArgs["sendCallsSyncAsync"];

export type WagmiConnectionShape = {
  connectorId: string;
  connectorName: string;
  address: `0x${string}`;
  chainId?: number;
};

export type RawWagmiConnectionShape = {
  connectorId: string;
  connectorUid: string;
  connectorName: string;
  accounts: readonly `0x${string}`[];
  chainId?: number;
};

const isEvmAddress = (address: string): address is `0x${string}` =>
  address.startsWith("0x");

export function useGetWalletClientFor(): (args: {
  connector?: Connector;
  chainId?: number;
}) => Promise<WalletClient | null> {
  const config = useConfig();
  return async ({ connector, chainId }) => {
    if (!connector) return null;
    try {
      return await getWalletClient(config, { connector, chainId } as never);
    } catch (error) {
      walletDebug("aa:wallet-client-failed", {
        connector: connector.id,
        chainId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
}

export function useWalletCapabilities(args: {
  account?: Address;
  connector?: Connector;
  stableId?: string;
  walletName?: string;
}): WalletCapabilities {
  const { data } = useCapabilities({
    account: args.account,
    connector: args.connector,
    query: { enabled: shouldProbeWalletCapabilities(args), retry: false },
  } as never);
  return normalizeAtomicCapabilities(data as WalletCapabilities);
}

/** Rabby rejects the capabilities probe with a user-facing prompt. */
export function shouldProbeWalletCapabilities(args?: {
  account?: Address;
  connector?: Pick<Connector, "id" | "name" | "type" | "uid">;
  stableId?: string;
  walletName?: string;
}): boolean {
  if (!args?.account || !args.connector) return false;

  const key = canonicalWalletKey(
    [
      args.stableId,
      args.walletName,
      args.connector.id,
      args.connector.name,
      args.connector.type,
      args.connector.uid,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return key !== "rabby";
}

export function useSendCallsSyncExecutor(): NonNullable<SendCallsSync> {
  const { sendCallsSyncAsync } = useSendCallsSync();
  return ({
    calls,
    capabilities,
    chainId,
    connector,
    forceAtomic,
    pollingInterval,
    status,
    throwOnFailure,
    timeout,
    version,
  }) =>
    sendCallsSyncAsync({
      calls,
      capabilities,
      chainId,
      connector: connector as Connector | undefined,
      forceAtomic,
      pollingInterval,
      status,
      throwOnFailure,
      timeout,
      version,
    });
}

export function useRawWagmiConnections(): RawWagmiConnectionShape[] {
  const connections = useConnections();
  return useMemo(
    () =>
      connections.map((connection) => ({
        connectorId: connection.connector.id,
        connectorUid: connection.connector.uid,
        connectorName: connection.connector.name,
        accounts: connection.accounts.filter(isEvmAddress),
        chainId: connection.chainId,
      })),
    [connections],
  );
}

/** One entry per connected account, stable while wagmi's store is unchanged. */
export function useWagmiConnections(): WagmiConnectionShape[] {
  const connections = useConnections();
  return useMemo(
    () =>
      connections.flatMap((connection) =>
        connection.accounts.filter(isEvmAddress).map((address) => ({
          connectorId: connection.connector.uid,
          connectorName: connection.connector.name,
          address,
          chainId: connection.chainId,
        })),
      ),
    [connections],
  );
}
