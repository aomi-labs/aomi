import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import type {
  AtomicBatchArgs,
  ExecuteWalletCallsParams,
  ExecutionResult,
  NativeWalletExecutionPolicy,
  PartialWalletExecution,
  SponsorshipPaymasterServiceContext,
  WalletCapabilities,
} from "./types";

const ERC20_PAYMENT_CONTEXT_KEYS = new Set(["erc20", "paymasterAddress"]);
const AA_DEBUG_STORAGE_KEYS = ["aomi:debug-aa", "AOMI_DEBUG_AA"];

export class PartialWalletExecutionError extends Error {
  readonly partial: PartialWalletExecution;

  constructor(
    error: unknown,
    completedTxHashes: string[],
    failedCallIndex: number,
  ) {
    const failureReason = walletExecutionFailureReason(error);
    super(failureReason);
    this.name = "PartialWalletExecutionError";
    this.partial = {
      completedTxHashes: [...completedTxHashes],
      failedCallIndex,
      failureReason,
    };
  }
}

function walletExecutionFailureReason(error: unknown): string {
  if (error && typeof error === "object") {
    for (const field of ["details", "shortMessage"] as const) {
      const value = (error as Record<string, unknown>)[field];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return message
    .split(/\n(?:\n|URL:|Request body:|Request Arguments:)/, 1)[0]
    .trim();
}

export function partialWalletExecution(
  error: unknown,
): PartialWalletExecution | undefined {
  if (!error || typeof error !== "object" || !("partial" in error)) {
    return undefined;
  }
  const partial = (error as { partial?: Partial<PartialWalletExecution> })
    .partial;
  if (
    !partial ||
    !Array.isArray(partial.completedTxHashes) ||
    partial.completedTxHashes.length === 0 ||
    !partial.completedTxHashes.every((hash) => typeof hash === "string") ||
    !Number.isInteger(partial.failedCallIndex) ||
    typeof partial.failureReason !== "string"
  ) {
    return undefined;
  }
  return partial as PartialWalletExecution;
}

function normalizeRpcCallData(data: Hex | undefined): Hex | undefined {
  return data === "0x" ? undefined : data;
}

function isAADebugEnabled(): boolean {
  const debugGlobal = globalThis as typeof globalThis & {
    __AOMI_DEBUG_AA?: boolean;
    localStorage?: Storage;
  };

  if (debugGlobal.__AOMI_DEBUG_AA === true) {
    return true;
  }

  try {
    return AA_DEBUG_STORAGE_KEYS.some((key) => {
      const value = debugGlobal.localStorage?.getItem(key);
      return value === "1" || value === "true";
    });
  } catch {
    return false;
  }
}

function debugAA(label: string, data: unknown) {
  if (!isAADebugEnabled()) return;
  console.info(`[aomi][aa][debug] ${label}`, data);
}

// ---------------------------------------------------------------------------
// Public Entry Point
// ---------------------------------------------------------------------------

/**
 * Execute staged wallet calls with the native wallet surface: a local private
 * key (sequential sends), or the connected wallet via EIP-5792 `sendCalls`
 * (atomic batching + wallet-side paymaster sponsorship) with sequential
 * `sendTransaction` fallback.
 *
 * Client-side smart-account (4337/7702) construction was removed — account
 * abstraction for held keys is executed server-side by the backend.
 */
export async function executeWalletCalls(
  params: ExecuteWalletCallsParams,
): Promise<ExecutionResult> {
  const {
    callList,
    currentChainId,
    capabilities,
    localPrivateKey,
    nativeWalletExecution,
    bundle = false,
    sendCallsSyncAsync,
    sendTransactionAsync,
    switchChainAsync,
    chainsById,
    getPreferredRpcUrl,
  } = params;

  const hashes: string[] = [];
  const normalizedCalls = callList.map((call) => ({
    ...call,
    data: normalizeRpcCallData(call.data),
  }));
  const requiresAtomicForBatch =
    Boolean(nativeWalletExecution?.requiresAtomicForBatch) &&
    normalizedCalls.length > 1;
  const nativeExecutionKind = nativeWalletExecution?.executionKind ?? "eoa";
  const sponsorship = nativeWalletExecution?.sponsorship;
  const requiresSponsoredSendCalls = sponsorship?.mode === "required";

  if (localPrivateKey) {
    if (requiresSponsoredSendCalls) {
      throw new Error("wallet_sponsorship_requires_send_calls");
    }

    if (requiresAtomicForBatch) {
      throw new Error("wallet_atomic_batch_required");
    }

    for (const [callIndex, call] of normalizedCalls.entries()) {
      try {
        const chain = chainsById[call.chainId];
        if (!chain) {
          throw new Error(`Unsupported chain ${call.chainId}`);
        }
        const rpcUrl = getPreferredRpcUrl(chain);
        if (!rpcUrl) {
          throw new Error(`No RPC for chain ${call.chainId}`);
        }

        const account = privateKeyToAccount(localPrivateKey);
        const walletClient = createWalletClient({
          account,
          chain,
          transport: http(rpcUrl),
        });
        const hash = await walletClient.sendTransaction({
          account,
          to: call.to,
          value: call.value,
          data: call.data,
        });
        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error(`Transaction ${hash} reverted`);
        }
        hashes.push(hash);
      } catch (error) {
        if (hashes.length > 0) {
          throw new PartialWalletExecutionError(error, hashes, callIndex);
        }
        throw error;
      }
    }

    return {
      txHash: hashes[hashes.length - 1],
      txHashes: hashes,
      executionKind: "eoa",
      batched: normalizedCalls.length > 1,
      sponsored: false,
    };
  }

  const chainIds = Array.from(
    new Set(normalizedCalls.map((call) => call.chainId)),
  );
  if (chainIds.length > 1) {
    throw new Error("mixed_chain_bundle_not_supported");
  }

  const chainId = chainIds[0];
  if (currentChainId !== chainId) {
    await switchChainAsync({ chainId });
  }

  const chainCaps = resolveChainCapabilities(capabilities, chainId);
  const atomicStatus = chainCaps?.atomic?.status;
  const canUseAtomicSendCalls =
    normalizedCalls.length > 1 &&
    (atomicStatus === "supported" || atomicStatus === "ready");
  const canUseSendCalls =
    bundle || canUseAtomicSendCalls || requiresSponsoredSendCalls;
  const sendCallsCapabilities = buildSendCallsCapabilities({
    chainCaps,
    nativeWalletExecution,
    requiresAtomicForBatch,
    canUseAtomicSendCalls,
  });

  debugAA("native-wallet-sendCalls-plan", {
    callCount: normalizedCalls.length,
    chainId,
    chainCaps,
    canUseAtomicSendCalls,
    canUseSendCalls,
    nativeExecutionKind,
    requiresAtomicForBatch,
    sponsorshipMode: sponsorship?.mode ?? "disabled",
    sendCallsCapabilities,
  });

  const sendSequentially = async () => {
    if (requiresAtomicForBatch) {
      throw new Error("wallet_atomic_batch_required");
    }

    for (const call of normalizedCalls) {
      const hash = await sendTransactionAsync({
        chainId: call.chainId,
        to: call.to,
        value: call.value,
        data: call.data,
      });
      hashes.push(hash);
    }
  };
  let usedPaymasterService = false;
  let usedSendCalls = false;

  if (canUseSendCalls) {
    try {
      const sendCallsArgs = {
        chainId,
        calls: normalizedCalls.map(({ to, value, data }) => ({
          to,
          value,
          data,
        })),
        capabilities: sendCallsCapabilities,
        // Atomicity means nothing for one call, and asking for it can make a
        // wallet offer a smart-account upgrade for a plain send.
        forceAtomic:
          requiresAtomicForBatch || (bundle && normalizedCalls.length > 1),
        status: (result: unknown) =>
          (result as { status?: string } | undefined)?.status === "success",
        throwOnFailure: true,
        timeout: nativeWalletExecution?.sendCallsTimeoutMs,
        version: nativeWalletExecution?.sendCallsVersion,
      };
      debugAA("native-wallet-sendCalls-args", sendCallsArgs);
      const batchResult = await sendCallsSyncAsync({
        ...sendCallsArgs,
      });
      debugAA("native-wallet-sendCalls-result", batchResult);

      hashes.push(...extractBatchTransactionHashes(batchResult));
      usedPaymasterService = Boolean(sendCallsCapabilities?.paymasterService);
      usedSendCalls = true;
    } catch (error) {
      if (
        !canFallbackToSequentialWalletSends(error, requiresSponsoredSendCalls)
      ) {
        throw error;
      }
      await sendSequentially();
    }
  } else {
    await sendSequentially();
  }

  // `usedPaymasterService = true` only means a paymaster config was passed to
  // sendCalls and the call resolved. It does NOT verify the wallet honored
  // the paymaster. With `sponsorship.mode === "optional"`, the wallet (e.g.
  // Coinbase Smart Wallet / Base Account) may silently fall back to
  // user-paid while sendCalls still succeeds. In that case the honest
  // answer is "we don't know" — report `undefined` rather than guess.
  // `required` mode is verified by the protocol: tx fails if the paymaster
  // rejects, so success ⟹ paymaster paid.
  const sponsoredResult: boolean | undefined = !usedSendCalls
    ? false
    : sponsorship?.mode === "optional"
      ? undefined
      : usedPaymasterService;

  return {
    txHash: hashes[hashes.length - 1],
    txHashes: hashes,
    executionKind: usedSendCalls ? nativeExecutionKind : "eoa",
    batched: normalizedCalls.length > 1,
    sponsored: sponsoredResult,
  };
}

export function extractBatchTransactionHashes(batchResult: unknown): string[] {
  const receipts =
    (
      batchResult as {
        receipts?: Array<{ transactionHash?: string; hash?: string }>;
      }
    ).receipts ?? [];
  const hashes = receipts.flatMap((receipt) => {
    const hash = receipt.transactionHash ?? receipt.hash;
    return hash ? [hash] : [];
  });

  if (hashes.length === 0) {
    throw new Error("wallet_send_calls_missing_transaction_hash");
  }

  return hashes;
}

function buildSendCallsCapabilities({
  chainCaps,
  nativeWalletExecution,
  requiresAtomicForBatch,
  canUseAtomicSendCalls,
}: {
  chainCaps: WalletCapabilities | undefined;
  nativeWalletExecution: NativeWalletExecutionPolicy | undefined;
  requiresAtomicForBatch: boolean;
  canUseAtomicSendCalls: boolean;
}): AtomicBatchArgs["capabilities"] | undefined {
  const capabilities: AtomicBatchArgs["capabilities"] = {};

  if (canUseAtomicSendCalls) {
    capabilities.atomic = requiresAtomicForBatch
      ? { required: true }
      : { optional: true };
  }

  const sponsorship = nativeWalletExecution?.sponsorship;
  if (sponsorship?.mode === "required") {
    if (!sponsorship.paymasterServiceUrl) {
      throw new Error("wallet_paymaster_service_url_required");
    }
    if (chainCaps?.paymasterService?.supported !== true) {
      throw new Error("wallet_paymaster_service_unsupported");
    }

    const context = sanitizeSponsorshipPaymasterServiceContext(
      sponsorship.paymasterServiceContext,
    );

    capabilities.paymasterService = {
      url: sponsorship.paymasterServiceUrl,
      context: context ?? {},
    };
  } else if (
    sponsorship?.mode === "optional" &&
    sponsorship.paymasterServiceUrl &&
    chainCaps?.paymasterService?.supported === true
  ) {
    const context = sanitizeSponsorshipPaymasterServiceContext(
      sponsorship.paymasterServiceContext,
    );

    capabilities.paymasterService = {
      url: sponsorship.paymasterServiceUrl,
      optional: true,
      ...(context ? { context } : {}),
    };
  }

  return Object.keys(capabilities).length > 0 ? capabilities : undefined;
}

function sanitizeSponsorshipPaymasterServiceContext(
  context: SponsorshipPaymasterServiceContext | undefined,
): SponsorshipPaymasterServiceContext | undefined {
  if (!context) return undefined;

  const filteredEntries = Object.entries(context).filter(
    ([key]) => !ERC20_PAYMENT_CONTEXT_KEYS.has(key),
  );

  if (filteredEntries.length === Object.keys(context).length) {
    return context;
  }

  console.warn(
    "[aomi][aa] Ignoring ERC20 paymaster payment context on a sponsorship request",
  );

  const filteredContext = Object.fromEntries(
    filteredEntries,
  ) as SponsorshipPaymasterServiceContext;
  return Object.keys(filteredContext).length > 0 ? filteredContext : undefined;
}

type ErrorLink = { code?: unknown; cause?: unknown; callsId?: unknown };

/** `error` and every cause under it, outermost first. */
export function errorChain(error: unknown): ErrorLink[] {
  const chain: ErrorLink[] = [];
  for (
    let link = error as ErrorLink | undefined;
    link && typeof link === "object" && !chain.includes(link);
    link = link.cause as ErrorLink | undefined
  )
    chain.push(link);
  return chain;
}

/** The wallet answered a call id (`callsId`) somewhere in `error`'s chain:
 * the calls may be out, whatever failed after. */
export const callsAccepted = (error: unknown): boolean =>
  errorChain(error).some((link) => link.callsId !== undefined);

/** EIP-5792 / EIP-1193 codes for a bundle refused before anything was sent:
 * an unsupported capability (5700), no atomic execution (5760), or no such
 * method (-32601, 4200). */
const BATCH_REFUSALS = new Set<unknown>([5700, 5760, -32601, 4200]);

/** Only a clean refusal sends the calls again one by one: no call id
 * anywhere in the chain, and every code in it a refusal. A 4001 rejection,
 * a 5750 declined upgrade or any other code blocks it, as does a timeout,
 * which carries no refusal code. */
function canFallbackToSequentialWalletSends(
  error: unknown,
  requiresSponsoredSendCalls: boolean,
): boolean {
  const codes = errorChain(error).flatMap(({ code }) =>
    code === undefined ? [] : [code],
  );
  return (
    !requiresSponsoredSendCalls &&
    !callsAccepted(error) &&
    codes.length > 0 &&
    codes.every((code) => BATCH_REFUSALS.has(code))
  );
}

function resolveChainCapabilities(
  capabilities: ExecuteWalletCallsParams["capabilities"],
  chainId: number,
): WalletCapabilities | undefined {
  if (!capabilities) {
    return undefined;
  }

  const asRecord = capabilities as Record<string, WalletCapabilities>;
  const eip155Key = `eip155:${chainId}`;
  const decimalKey = String(chainId);
  const hexKey = `0x${chainId.toString(16)}`;

  return asRecord[eip155Key] ?? asRecord[decimalKey] ?? asRecord[hexKey];
}
