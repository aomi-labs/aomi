"use client";

import { type executeWalletCalls } from "@aomi-labs/client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import {
  getConnectorClient,
  getWalletClient,
  sendCalls,
  waitForCallsStatus,
} from "wagmi/actions";
import { useConfig, useConnections, useWalletClient } from "wagmi";
import type { Connector } from "wagmi";
import { normalizeAtomicCapabilities } from "@/wallet/execution/wallet-execution";
import {
  knownNoEip5792,
  markNoEip5792,
  probeWalletCapabilities,
  type CapabilityProbe,
  type CapabilityRequest,
} from "./capability-probe";
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

export type WalletCapabilityProbe = {
  capabilities: WalletCapabilities;
};

/**
 * Probe the CONNECTED connector's own provider (never `window.ethereum`).
 * A failed probe is retried with backoff and again on focus/remount; only an
 * answer is cached.
 */
export function useWalletCapabilities(args: {
  account?: Address;
  connector?: Connector;
  stableId?: string;
  walletName?: string;
  chainId?: number;
  chainIds?: readonly number[];
}): WalletCapabilityProbe {
  const config = useConfig();
  const { account, connector, chainId } = args;
  const chainIds = args.chainIds ?? [];
  const known = connector ? knownNoEip5792(connector.uid) : false;
  const enabled = shouldProbeWalletCapabilities(args) && !known;
  const { data } = useQuery({
    queryKey: [
      "aomi-wallet-capabilities",
      connector?.uid,
      args.stableId ?? connector?.id,
      account,
      chainId,
    ],
    enabled,
    queryFn: async () => {
      const client = await getConnectorClient(config, {
        account,
        connector,
      } as never);
      const probe = await probeWalletCapabilities({
        request: client.request as CapabilityRequest,
        address: account as string,
        chainIds: chainIds.length ? chainIds : chainId ? [chainId] : [],
      });
      if (probe.unsupported && connector) markNoEip5792(connector.uid);
      logCapabilityProbe(connector, account, probe);
      return probe;
    },
    retry: (count) => count < 2,
    retryDelay: (count) => 400 * 2 ** count,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnReconnect: false,
    refetchOnWindowFocus: (query) => query.state.data === undefined,
    refetchOnMount: (query) => query.state.data === undefined,
  });
  const capabilities = useMemo(
    () => normalizeAtomicCapabilities(data?.capabilities),
    [data],
  );
  return { capabilities };
}

function logCapabilityProbe(
  connector: Connector | undefined,
  account: string | undefined,
  probe: CapabilityProbe,
) {
  walletDebug("aa:capabilities", {
    connector: connector?.id,
    uid: connector?.uid,
    account,
    unsupported: probe.unsupported ?? false,
    chains: Object.fromEntries(
      Object.entries(probe.capabilities).map(([chain, cap]) => [
        chain,
        cap?.atomic?.status ?? "none",
      ]),
    ),
  });
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

/** `wallet_sendCalls`, then its status. A failure after the wallet answered
 * a call id wraps its cause in an error carrying that `callsId`: the calls
 * may be out, so nothing sends them again or reads it as a rejection. */
export function useSendCallsSyncExecutor(): NonNullable<SendCallsSync> {
  const config = useConfig();
  return async ({
    account,
    calls,
    capabilities,
    chainId,
    connector: anyConnector,
    forceAtomic,
    pollingInterval,
    onAccepted,
    status,
    throwOnFailure,
    timeout,
    version,
  }) => {
    const connector = anyConnector as Connector | undefined;
    const { id } = await sendCalls(config, {
      account,
      calls,
      capabilities,
      chainId,
      connector,
      forceAtomic,
      version,
    });
    try {
      onAccepted?.(id);
      return await waitForCallsStatus(config, {
        connector,
        id,
        pollingInterval,
        status,
        throwOnFailure,
        timeout,
      });
    } catch (cause) {
      // Accepted: whatever the status query answers, even a 4001, the calls
      // may land.
      throw Object.assign(
        new Error("The wallet accepted the calls; their outcome is unknown", {
          cause,
        }),
        { callsId: id },
      );
    }
  };
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
