"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import {
  AomiWalletKitContextProvider,
  ExtUserProvider,
  type AomiWalletKit,
  type AomiSessionIdentity,
} from "@aomi-labs/widget-lib";
import type {
  WalletEip712Payload,
  WalletSolanaSignMessagePayload,
  WalletSolanaSignPayload,
  WalletTxPayload,
} from "@aomi-labs/react";
import { http, type Chain } from "viem";
import { createConfig, WagmiProvider } from "wagmi";
import { API_PATHS } from "@portal/lib/api-paths";

export type E2EWalletSeedClient = {
  address?: `0x${string}`;
  chainId?: number;
  svmAddress?: string;
  svmCluster?: "solana:devnet" | "solana:testnet" | "solana:mainnet";
};

type Props = {
  children: ReactNode;
  seed: E2EWalletSeedClient;
  networks: readonly Chain[];
  solanaNetworks: readonly {
    id: string;
    label: string;
    cluster: "solana:mainnet" | "solana:devnet" | "solana:testnet";
    rpcHttpUrl: string;
    rpcWsUrl?: string;
    isDefault?: boolean;
  }[];
};

type E2EExecutionSuccess = {
  ok: true;
  txHash: `0x${string}`;
  valueWei: string;
  executionKind: "e2e_real_self_transfer" | "e2e_real_fork_call";
};

type E2EExecutionPartial = {
  executedTxIds: number[];
  lastTxHash: `0x${string}` | null;
  failedTxId: number | null;
  remainingTxIds: number[];
};

type E2EExecutionResponse =
  | E2EExecutionSuccess
  | {
      ok: false;
      error: string;
      /** Sequential batches can land a prefix before failing — see
       * `E2EPartialExecution` in server/e2e-wallet.ts. */
      partial?: E2EExecutionPartial;
    };

/** Thrown when a batch aborted mid-way with legs already mined; carries
 * the partial outcome so the runtime tx handler can report per-leg truth
 * instead of a blanket failure. */
export class E2EPartialExecutionError extends Error {
  constructor(
    message: string,
    public readonly partial: E2EExecutionPartial,
  ) {
    super(message);
    this.name = "E2EPartialExecutionError";
  }
}

type E2ESolanaResponse =
  | { ok: true; signature: string; signedTx?: string }
  | { ok: false; error: string };

const useRealE2EExecution =
  process.env.NEXT_PUBLIC_AOMI_E2E_EXECUTION_MODE === "real";

export function stringifyE2EPayload(value: unknown): string {
  // viem's EIP-712 payload carries integer fields as bigint. The disposable
  // browser signer hashes the payload instead of serializing it onto a wire,
  // so preserve those values losslessly as decimal strings for a stable fake
  // signature.
  return JSON.stringify(value, (_key, nested) =>
    typeof nested === "bigint" ? nested.toString() : nested,
  );
}

function fakeTxHash(payload: WalletTxPayload): `0x${string}` {
  const encoded = stringifyE2EPayload({
    chainId: payload.chainId,
    calls: payload.calls,
    txId: payload.txId,
    txIds: payload.txIds,
  });
  let hash = 0x811c9dc5;
  for (let i = 0; i < encoded.length; i += 1) {
    hash ^= encoded.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `0xe2e${Math.abs(hash).toString(16).padStart(61, "0").slice(0, 61)}`;
}

function fakeSignature(payload: WalletEip712Payload): `0x${string}` {
  const encoded = stringifyE2EPayload(payload);
  let hash = 0;
  for (let i = 0; i < encoded.length; i += 1) {
    hash = (hash * 31 + encoded.charCodeAt(i)) >>> 0;
  }
  return `0x${hash.toString(16).padStart(130, "0")}`;
}

async function executeRealE2ETransaction(
  payload: WalletTxPayload,
): Promise<E2EExecutionSuccess> {
  const response = await fetch(API_PATHS.bff.e2e.execute, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload }),
  });
  const result = (await response.json()) as E2EExecutionResponse;
  if (!result.ok) {
    if (result.partial && result.partial.executedTxIds.length > 0) {
      throw new E2EPartialExecutionError(result.error, result.partial);
    }
    throw new Error(result.error);
  }
  if (!response.ok) {
    throw new Error("E2E execution failed");
  }
  return result;
}

async function executeRealE2ESolana(
  action: "sign" | "sign-and-send" | "sign-message",
  payload: WalletSolanaSignPayload | WalletSolanaSignMessagePayload,
): Promise<Extract<E2ESolanaResponse, { ok: true }>> {
  const response = await fetch(API_PATHS.bff.e2e.solana, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const result = (await response.json()) as E2ESolanaResponse;
  if (!response.ok || !result.ok) {
    throw new Error(result.ok ? "E2E Solana execution failed" : result.error);
  }
  return result;
}

export function E2EWalletProvider({
  children,
  seed,
  networks,
  solanaNetworks,
}: Props) {
  const [queryClient] = useState(() => new QueryClient());
  const wagmiConfig = useMemo(
    () =>
      createConfig({
        chains: networks as readonly [Chain, ...Chain[]],
        transports: Object.fromEntries(
          networks.map((chain) => [
            chain.id,
            http(chain.rpcUrls.default.http[0]),
          ]),
        ),
        multiInjectedProviderDiscovery: false,
        ssr: true,
      }),
    [networks],
  );
  const adapter = useMemo<AomiWalletKit>(() => {
    const identity: AomiSessionIdentity = {
      status: "connected",
      isConnected: true,
      address: seed.address,
      walletKind: "eoa",
      chainId: seed.chainId,
      svmAddress: seed.svmAddress,
      svmCluster: seed.svmCluster,
      svmWalletName: seed.svmAddress ? "E2E Solana Wallet" : undefined,
      svmTransport: seed.svmAddress ? "embedded" : undefined,
      svmCapabilities: seed.svmAddress
        ? {
            canSignMessage: true,
            canSignTransaction: true,
            canSendTransaction: true,
            canSignAndSendTransaction: true,
          }
        : undefined,
      sessionProvider: "para",
      walletProviderSubject: `e2e:${(
        seed.address ??
        seed.svmAddress ??
        "wallet"
      ).toLowerCase()}`,
      authMethod: "email",
      authValue: "e2e@aomi.dev",
      authVerifiedAt: Math.floor(Date.now() / 1000),
      primaryLabel: seed.address ? "E2E Wallet" : "E2E Solana Wallet",
      secondaryLabel: seed.address ?? seed.svmAddress,
    };

    return {
      identity,
      isReady: true,
      isSwitchingChain: false,
      canConnect: false,
      canOpenAccountUI: false,
      canDisconnect: false,
      supportedNetworks: {
        evm: networks,
        solana: solanaNetworks,
      },
      accounts: [
        ...(seed.address
          ? [
              {
                id: `e2e:${seed.address.toLowerCase()}`,
                family: "evm" as const,
                address: seed.address,
                label: "E2E Wallet",
                walletName: "E2E Wallet",
                active: true,
              },
            ]
          : []),
        ...(seed.svmAddress
          ? [
              {
                id: `e2e:${seed.svmAddress}`,
                family: "svm" as const,
                address: seed.svmAddress,
                label: "E2E Solana Wallet",
                walletName: "E2E Solana Wallet",
                active: true,
              },
            ]
          : []),
      ],
      selectAccount: async () => undefined,
      connect: async () => undefined,
      openAccountUI: async () => undefined,
      disconnect: async () => undefined,
      switchChain: async () => undefined,
      selectNetwork: async () => undefined,
      sendTransaction: async (payload) => {
        if (useRealE2EExecution) {
          const result = await executeRealE2ETransaction(payload);
          return {
            txHash: result.txHash,
            amount: result.valueWei,
            aaRequestedMode: "none",
            aaResolvedMode: "none",
            executionKind: result.executionKind,
            batched: false,
            callCount: payload.calls?.length ?? 1,
            sponsored: false,
          };
        }

        return {
          txHash: fakeTxHash(payload),
          aaRequestedMode: "none",
          aaResolvedMode: "none",
          executionKind: "e2e_fake_wallet",
          batched: Array.isArray(payload.calls) && payload.calls.length > 1,
          callCount: payload.calls?.length,
          sponsored: false,
        };
      },
      signTypedData: async (payload) => ({
        signature: fakeSignature(payload),
      }),
      signMessage: async (payload) => ({
        signature: fakeSignature(payload),
      }),
      signSolanaMessage: seed.svmAddress
        ? async (payload) => {
            const result = await executeRealE2ESolana("sign-message", payload);
            return { signature: result.signature };
          }
        : undefined,
      signSolanaTransaction: seed.svmAddress
        ? async (payload) => {
            const result = await executeRealE2ESolana("sign", payload);
            if (!result.signedTx)
              throw new Error("E2E signer returned no transaction");
            return { signedTx: result.signedTx };
          }
        : undefined,
      sendSolanaTransaction: seed.svmAddress
        ? async (payload) => executeRealE2ESolana("sign-and-send", payload)
        : undefined,
      signAndSendSolanaTransaction: seed.svmAddress
        ? async (payload) => executeRealE2ESolana("sign-and-send", payload)
        : undefined,
      solanaRpcHttpUrl: seed.svmCluster
        ? solanaNetworks.find((network) => network.cluster === seed.svmCluster)
            ?.rpcHttpUrl
        : undefined,
      getEmbeddedCredential: async () => null,
    };
  }, [networks, seed, solanaNetworks]);

  return (
    <ExtUserProvider>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <AomiWalletKitContextProvider value={adapter}>
            {children}
          </AomiWalletKitContextProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </ExtUserProvider>
  );
}
