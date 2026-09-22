"use client";

import { useMemo } from "react";
import type { Address, Chain } from "viem";
import { getWalletClient } from "wagmi/actions";
import {
  useCapabilities,
  useConfig,
  useConnect,
  useConnections,
  useConnectors,
  useDisconnect,
  useReconnect,
  useSendCallsSync,
  useSendTransaction,
  useSignMessage,
  useSignTypedData,
  useSwitchAccount,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import type { Connector } from "wagmi";
import type { executeWalletCalls } from "@aomi-labs/react";
import { normalizeAtomicCapabilities } from "../../execution/wallet-execution";
import { walletDebug } from "../../wallet-debug";
import { canonicalWalletKey } from "../../catalog/wallet-branding";

export type WagmiConfigShape = {
  chains: readonly Chain[];
  connectors: readonly Connector[];
};

const DISCONNECTED_WAGMI_CONFIG: WagmiConfigShape = {
  chains: [],
  connectors: [],
};

type SafeSendTransactionArgs = {
  account?: `0x${string}`;
  chainId?: number;
  connector?: Connector;
  data?: `0x${string}`;
  nonce?: number;
  to: `0x${string}`;
  value?: bigint;
};

export function useSafeWalletClient(): {
  walletClient?: ReturnType<typeof useWalletClient>["data"];
} {
  try {
    const { data } = useWalletClient();
    return { walletClient: data };
  } catch {
    return { walletClient: undefined };
  }
}

export function useSafeGetWalletClientFor(): (args: {
  connector?: Connector;
  chainId?: number;
}) => Promise<ReturnType<typeof useWalletClient>["data"] | null> {
  try {
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
  } catch {
    return async () => null;
  }
}

export function useSafeWagmiConfig(): WagmiConfigShape {
  try {
    const config = useConfig();
    return {
      chains: config.chains ?? [],
      connectors: config.connectors ?? [],
    };
  } catch {
    return DISCONNECTED_WAGMI_CONFIG;
  }
}

export function useSafeSwitchChain(): {
  switchChainAsync?: (args: {
    chainId: number;
    connector?: Connector;
  }) => Promise<unknown>;
  isPending: boolean;
} {
  try {
    const result = useSwitchChain();
    return {
      switchChainAsync: result.switchChainAsync,
      isPending: result.isPending,
    };
  } catch {
    return {
      switchChainAsync: undefined,
      isPending: false,
    };
  }
}

export function useSafeSendTransaction(): {
  sendTransactionAsync?: (args: SafeSendTransactionArgs) => Promise<string>;
} {
  try {
    return useSendTransaction() as {
      sendTransactionAsync?: (args: SafeSendTransactionArgs) => Promise<string>;
    };
  } catch {
    return { sendTransactionAsync: undefined };
  }
}

export function useSafeSignTypedData(): {
  signTypedDataAsync?: (args: unknown) => Promise<string>;
} {
  try {
    return useSignTypedData() as {
      signTypedDataAsync?: (args: unknown) => Promise<string>;
    };
  } catch {
    return { signTypedDataAsync: undefined };
  }
}

export function useSafeSignMessage(): {
  signMessageAsync?: (args: unknown) => Promise<string>;
} {
  try {
    return useSignMessage() as {
      signMessageAsync?: (args: unknown) => Promise<string>;
    };
  } catch {
    return { signMessageAsync: undefined };
  }
}

export function useSafeCapabilities(args?: {
  account?: Address;
  connector?: Connector;
  stableId?: string;
  walletName?: string;
}): {
  capabilities?: Parameters<typeof executeWalletCalls>[0]["capabilities"];
} {
  try {
    const enabled = shouldProbeWalletCapabilities(args);
    const { data } = useCapabilities({
      account: args?.account,
      connector: args?.connector,
      query: {
        enabled,
        retry: false,
      },
    } as never);
    return {
      capabilities: normalizeAtomicCapabilities(
        data as Parameters<typeof executeWalletCalls>[0]["capabilities"],
      ),
    };
  } catch {
    return { capabilities: undefined };
  }
}

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

export function useSafeSendCallsSync(): {
  sendCallsSyncAsync?: Parameters<
    typeof executeWalletCalls
  >[0]["sendCallsSyncAsync"];
} {
  try {
    const { sendCallsSyncAsync } = useSendCallsSync();
    return {
      sendCallsSyncAsync: async ({
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
      }) => {
        return sendCallsSyncAsync({
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
      },
    };
  } catch {
    return { sendCallsSyncAsync: undefined };
  }
}

export function useSafeConnect(): {
  connectAsync?: ReturnType<typeof useConnect>["connectAsync"];
  isPending: boolean;
} {
  try {
    const { connectAsync, isPending } = useConnect();
    return { connectAsync, isPending };
  } catch {
    return { connectAsync: undefined, isPending: false };
  }
}

export function useSafeDisconnect(): {
  disconnectAsync?: ReturnType<typeof useDisconnect>["disconnectAsync"];
  isPending: boolean;
} {
  try {
    const { disconnectAsync, isPending } = useDisconnect();
    return { disconnectAsync, isPending };
  } catch {
    return { disconnectAsync: undefined, isPending: false };
  }
}

export function useSafeReconnect(): {
  reconnect?: ReturnType<typeof useReconnect>["reconnect"];
  reconnectAsync?: ReturnType<typeof useReconnect>["reconnectAsync"];
} {
  try {
    const { reconnect, reconnectAsync } = useReconnect();
    return { reconnect, reconnectAsync };
  } catch {
    return { reconnect: undefined, reconnectAsync: undefined };
  }
}

export function useSafeConnectors(): ReturnType<typeof useConnectors> {
  try {
    return useConnectors();
  } catch {
    return [];
  }
}

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

export function useSafeRawWagmiConnections(): RawWagmiConnectionShape[] {
  try {
    const connections = useConnections();
    return useMemo(
      () =>
        connections.map((connection) => ({
          connectorId: connection.connector.id,
          connectorUid: connection.connector.uid,
          connectorName: connection.connector.name,
          accounts: connection.accounts.filter(
            (address): address is `0x${string}` => address.startsWith("0x"),
          ),
          chainId: connection.chainId,
        })),
      [connections],
    );
  } catch {
    return [];
  }
}

export function useSafeConnections(): WagmiConnectionShape[] {
  try {
    const connections = useConnections();
    // Memoized on the store snapshot so consumers (adapter memos, effects)
    // see a stable identity when nothing actually changed.
    return useMemo(
      () =>
        connections.flatMap((connection) =>
          connection.accounts
            .filter((address): address is `0x${string}` =>
              address.startsWith("0x"),
            )
            .map((address) => ({
              connectorId: connection.connector.uid,
              connectorName: connection.connector.name,
              address,
              chainId: connection.chainId,
            })),
        ),
      [connections],
    );
  } catch {
    return [];
  }
}

export function useSafeSwitchAccount(): {
  switchAccountAsync?: (args: {
    connector: Parameters<
      ReturnType<typeof useSwitchAccount>["switchAccountAsync"]
    >[0]["connector"];
  }) => Promise<unknown>;
} {
  try {
    const { switchAccountAsync } = useSwitchAccount();
    return { switchAccountAsync };
  } catch {
    return { switchAccountAsync: undefined };
  }
}
