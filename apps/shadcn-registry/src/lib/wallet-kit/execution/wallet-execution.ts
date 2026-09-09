"use client";

import { createPublicClient, http, type Chain, type Hex } from "viem";
import type {
  NativeWalletExecutionPolicy as ClientNativeWalletExecutionPolicy,
  SponsorshipPaymasterServiceContext,
  WalletCapabilities,
  WalletTxPayload,
} from "@aomi-labs/react";
import {
  aaModeFromExecutionKind,
  executeWalletCalls,
  toAAWalletCalls,
} from "@aomi-labs/react";
import type { AomiTxResult } from "../types";

export type RequestedAAMode = "none" | "4337" | "7702";
export type WalletExecutionCallList = Parameters<
  typeof executeWalletCalls
>[0]["callList"];

export type WalletExecutionKitState = {
  currentChainId?: number;
  capabilities?: Parameters<typeof executeWalletCalls>[0]["capabilities"];
  nativeWalletExecution?: NativeWalletExecutionPolicy;
  sendCallsSyncAsync?: Parameters<
    typeof executeWalletCalls
  >[0]["sendCallsSyncAsync"];
  sendTransactionAsync?: Parameters<
    typeof executeWalletCalls
  >[0]["sendTransactionAsync"];
  switchChainAsync?: Parameters<
    typeof executeWalletCalls
  >[0]["switchChainAsync"];
  chainsById: Record<number, Chain>;
  getPreferredRpcUrl?: (chain: Chain) => string;
  waitForTransactionReceipt?: (args: {
    chainId: number;
    hash: Hex;
  }) => Promise<{ status?: string }>;
};

export type NativeWalletExecutionPolicy = Omit<
  ClientNativeWalletExecutionPolicy,
  "sponsorship"
> & {
  sponsorship?:
    | { mode: "disabled" }
    | {
        mode: "optional";
        getPaymasterServiceContext?: (
          chainId: number,
        ) => SponsorshipPaymasterServiceContext | undefined;
        getPaymasterServiceUrl?: (chainId: number) => string | undefined;
      }
    | {
        mode: "required";
        getPaymasterServiceContext?: (
          chainId: number,
        ) => SponsorshipPaymasterServiceContext | undefined;
        getPaymasterServiceUrl?: (chainId: number) => string | undefined;
      };
};

export function getPreferredRpcUrl(chain: Chain): string {
  return chain.rpcUrls.default.http[0] ?? chain.rpcUrls.public?.http[0] ?? "";
}

/**
 * The AA mode the payload asked for — reporting only. Client-side smart
 * accounts were removed; account abstraction for staged calls happens
 * server-side. The connected wallet may still execute atomically/sponsored
 * via EIP-5792 `sendCalls`, reported through `executionKind`.
 */
export function resolveRequestedAAMode(
  payload: WalletTxPayload,
  isBatch: boolean,
): RequestedAAMode {
  if (payload.aaPreference === "none") return "none";
  if (!isBatch && !payload.aaStrict) return "none";
  if (payload.aaPreference === "eip4337") return "4337";
  return "7702";
}

export function normalizeAtomicCapabilities(
  raw: Record<string, WalletCapabilities> | undefined,
): Record<string, WalletCapabilities> | undefined {
  if (!raw) return undefined;

  const normalized: Record<string, WalletCapabilities> = {};
  for (const [key, capability] of Object.entries(raw)) {
    normalized[key] =
      capability.atomic?.status === "ready"
        ? {
            ...capability,
            atomic: {
              ...capability.atomic,
              status: "supported",
            },
          }
        : capability;
  }

  return normalized;
}

async function waitForReceipt(
  state: WalletExecutionKitState,
  chainId: number,
  hash: Hex,
): Promise<{ status?: string }> {
  if (state.waitForTransactionReceipt) {
    return state.waitForTransactionReceipt({ chainId, hash });
  }

  const chain = state.chainsById[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain ${chainId}`);
  }
  const rpcUrl = (state.getPreferredRpcUrl ?? getPreferredRpcUrl)(chain);
  if (!rpcUrl) {
    throw new Error(`No RPC for chain ${chainId}`);
  }
  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  }).waitForTransactionReceipt({ hash });
}

function transactionCallIds(payload: WalletTxPayload): number[] {
  if (payload.calls?.length) {
    return payload.calls.map((call) => call.txId);
  }
  return [payload.txId ?? payload.txIds?.[0] ?? 0];
}

function resolveNativeWalletExecutionPolicy({
  policy,
  chainId,
  requiresAtomicForBatch,
}: {
  policy?: NativeWalletExecutionPolicy;
  chainId: number;
  requiresAtomicForBatch: boolean;
}): ClientNativeWalletExecutionPolicy | undefined {
  if (!policy && !requiresAtomicForBatch) {
    return undefined;
  }

  const sponsorship =
    policy?.sponsorship?.mode === "optional" ||
    policy?.sponsorship?.mode === "required"
      ? {
          mode: policy.sponsorship.mode,
          paymasterServiceContext:
            policy.sponsorship.getPaymasterServiceContext?.(chainId),
          paymasterServiceUrl:
            policy.sponsorship.getPaymasterServiceUrl?.(chainId),
        }
      : policy?.sponsorship;

  return {
    executionKind: policy?.executionKind,
    requiresAtomicForBatch:
      requiresAtomicForBatch || policy?.requiresAtomicForBatch,
    sendCallsTimeoutMs: policy?.sendCallsTimeoutMs,
    sendCallsVersion: policy?.sendCallsVersion,
    sponsorship,
  };
}

export async function executeWalletKitTransaction({
  payload,
  state,
}: {
  payload: WalletTxPayload;
  state: WalletExecutionKitState;
}): Promise<AomiTxResult> {
  if (!payload.to && (!payload.calls || payload.calls.length === 0)) {
    throw new Error("pending_transaction_missing_call_data");
  }

  if (!state.sendTransactionAsync) {
    throw new Error("wallet_send_transaction_not_supported");
  }
  const sendTransactionAsync = state.sendTransactionAsync;
  const sendCallsSyncAsync = state.sendCallsSyncAsync;
  const switchChainAsync = state.switchChainAsync;

  const callList = toAAWalletCalls(
    payload,
    payload.chainId ?? state.currentChainId ?? 1,
  );
  const isBatch = callList.length > 1;
  const aaRequestedMode = resolveRequestedAAMode(payload, isBatch);
  // Atomic-required is a payload-level intent (`aaStrict === true`): a
  // fee-injected or dependent batch must not be silently split into
  // sequential sends.
  const requiresAtomicForBatch = isBatch && payload.aaStrict === true;
  if (
    payload.aaPreference === "none" &&
    state.nativeWalletExecution?.sponsorship?.mode === "required"
  ) {
    throw new Error("wallet_sponsorship_incompatible_with_prepared_eoa");
  }
  const nativeWalletExecution = resolveNativeWalletExecutionPolicy({
    policy:
      payload.aaPreference === "none" ? undefined : state.nativeWalletExecution,
    chainId: callList[0]?.chainId ?? state.currentChainId ?? 1,
    requiresAtomicForBatch,
  });

  const broadcastLegs: Array<{ chainId: number; hash: Hex }> = [];
  let revertedLegIndex: number | null = null;
  const callTxIds = transactionCallIds(payload);
  // Embedded providers may prepare each sequential transaction from the
  // latest mined nonce. Confirm the preceding leg before requesting the next
  // signature so the fee leg cannot reuse the user's transaction nonce.
  const sendSequentialTransaction: typeof sendTransactionAsync = async (
    args,
  ) => {
    const previousSend = broadcastLegs[broadcastLegs.length - 1];
    if (previousSend) {
      const receipt = await waitForReceipt(
        state,
        previousSend.chainId,
        previousSend.hash,
      );
      if (receipt.status === "reverted") {
        revertedLegIndex = broadcastLegs.length - 1;
        throw new Error("wallet_sequential_transaction_reverted");
      }
    }

    const hash = await sendTransactionAsync(args);
    broadcastLegs.push({ chainId: args.chainId, hash: hash as Hex });
    return hash;
  };

  let execution: Awaited<ReturnType<typeof executeWalletCalls>>;
  try {
    execution = await executeWalletCalls({
      callList,
      currentChainId: state.currentChainId,
      capabilities:
        payload.aaPreference === "none" ? undefined : state.capabilities,
      localPrivateKey: null,
      nativeWalletExecution,
      sendCallsSyncAsync: sendCallsSyncAsync
        ? async (args) => sendCallsSyncAsync(args)
        : async () => {
            throw new Error("wallet_send_calls_not_supported");
          },
      sendTransactionAsync: sendSequentialTransaction,
      switchChainAsync: switchChainAsync
        ? async ({ chainId }) => switchChainAsync({ chainId })
        : async () => {
            throw new Error("wallet_switch_chain_not_supported");
          },
      chainsById: state.chainsById,
      getPreferredRpcUrl: state.getPreferredRpcUrl ?? getPreferredRpcUrl,
    });

    // `sendTransactionAsync` resolves once the wallet broadcasts. Keep the
    // request — and therefore the trace's pending commit state — open until
    // the final sequential leg has an on-chain receipt. Earlier legs are
    // already confirmed before the next wallet signature is requested.
    const finalBroadcast = broadcastLegs[broadcastLegs.length - 1];
    if (finalBroadcast) {
      const receipt = await waitForReceipt(
        state,
        finalBroadcast.chainId,
        finalBroadcast.hash,
      );
      if (receipt.status === "reverted") {
        revertedLegIndex = broadcastLegs.length - 1;
        throw new Error("wallet_sequential_transaction_reverted");
      }
    }
  } catch (error) {
    // A broadcast leg counts as executed even when we never saw its receipt:
    // a receipt wait can fail on an RPC timeout while the transaction mines
    // anyway, and reporting that leg as un-run makes the backend re-queue a
    // transaction that is already on chain. A leg that mined *reverted* is
    // the failure itself, so it is excluded from the executed prefix.
    const landedLegCount = revertedLegIndex ?? broadcastLegs.length;
    const executedTxIds = callTxIds
      .slice(0, landedLegCount)
      .filter((txId) => txId > 0);
    const lastLandedHash = broadcastLegs[landedLegCount - 1]?.hash;
    if (executedTxIds.length > 0 && lastLandedHash) {
      const failedTxId = callTxIds[landedLegCount];
      const remainingTxIds = callTxIds
        .slice(landedLegCount + 1)
        .filter((txId) => txId > 0);
      const enrichedError =
        error instanceof Error ? error : new Error(String(error));
      Object.assign(enrichedError, {
        partial: {
          executedTxIds,
          lastTxHash: lastLandedHash,
          failedTxId:
            typeof failedTxId === "number" && failedTxId > 0
              ? failedTxId
              : null,
          remainingTxIds,
        },
      });
      throw enrichedError;
    }
    throw error;
  }

  if (!execution.txHash) {
    throw new Error("wallet_execution_missing_transaction_hash");
  }

  const aaResolvedMode: RequestedAAMode =
    aaModeFromExecutionKind(execution.executionKind) ?? "none";

  return {
    txHash: execution.txHash,
    amount: payload.value,
    aaRequestedMode,
    aaResolvedMode,
    aaFallbackReason:
      aaRequestedMode !== "none" && aaResolvedMode === "none"
        ? "aa_unavailable_fallback_eoa"
        : undefined,
    executionKind: execution.executionKind,
    batched: execution.batched,
    callCount: callList.length,
    sponsored: execution.sponsored,
  };
}
