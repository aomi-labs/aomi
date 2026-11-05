import {
  getAddress,
  isHex,
  parseSignature,
  recoverTransactionAddress,
  serializeTransaction,
  type TransactionSerializableEIP1559,
} from "viem";
import type { EvmWallet } from "@aomi-labs/client";
import { hexToBase64 } from "@/wallet/account/encoding";
import {
  findParaSigningWallet,
  type ParaSigningClient,
} from "./para-message-signing";

type PreparedEvmTransaction = Parameters<
  NonNullable<EvmWallet["signTransaction"]>
>[0];

/** The subset of Para's `signTransaction` (core-sdk 2.19–2.27) used here. */
export type ParaTransactionSigningClient = ParaSigningClient & {
  signTransaction?: (args: {
    walletId: string;
    rlpEncodedTxBase64: string;
    chainId?: string;
    timeoutMs?: number;
    isCanceled?: () => boolean;
    onTransactionReviewUrl?: (url: string) => void;
  }) => Promise<{ signature?: string; pendingTransactionId?: string }>;
};

/** Para's own review window: its polling extends any timeout to 5 minutes. */
export const PARA_REVIEW_TIMEOUT_MS = 5 * 60_000;
/** Our bound on top of Para's, in case its polling never returns. */
const GUARD_MS = 30_000;

/**
 * Para returned no signature. Nothing was broadcast: Aomi broadcasts a Para
 * transaction only after Commit Service has stored its signed bytes, and a
 * Para signature can only be produced by this client's own sign call. A retry
 * signs the same prepared transaction (same nonce), so at most one can land.
 */
export class ParaSigningIncompleteError extends Error {
  constructor(
    readonly reason: "timeout" | "provider_error" | "no_signature",
    readonly pendingTransactionId?: string,
    options?: { cause?: unknown },
  ) {
    super(
      reason === "timeout"
        ? "Para signing did not finish in time. Nothing was broadcast; try again to sign the same transaction."
        : "Para did not return a signature. Nothing was broadcast; try again to sign the same transaction.",
      options,
    );
    this.name = "ParaSigningIncompleteError";
  }
}

export function isParaTransactionSigner(
  para: ParaTransactionSigningClient | null | undefined,
  address: string | undefined,
): boolean {
  return Boolean(
    para?.signTransaction &&
    address &&
    findParaSigningWallet(para, address, "evm")?.id,
  );
}

/** The exact transaction Commit Service prepared, nonce included. */
export function paraUnsignedTransaction(
  payload: PreparedEvmTransaction,
): TransactionSerializableEIP1559 {
  const tx = payload.transaction;
  if (!isHex(tx.data)) throw new Error("Commit data is not hex");
  return {
    type: "eip1559",
    chainId: payload.chain_id,
    nonce: payload.nonce,
    to: getAddress(tx.to),
    data: tx.data,
    value: BigInt(tx.value),
    gas: BigInt(tx.gas_limit),
    maxFeePerGas: BigInt(tx.max_fee_per_gas),
    maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas),
  };
}

/**
 * Sign a prepared commit transaction with the Para embedded wallet. Para's
 * review page is handed to `onReviewUrl` instead of a `window.open` after
 * async work, which browsers block (and Para's SDK then waits forever for the
 * window). The caller shows it behind a button, a fresh user gesture.
 * Returns the signed serialized transaction; it is never broadcast here.
 */
export async function signParaTransaction(
  para: ParaTransactionSigningClient,
  payload: PreparedEvmTransaction,
  options: {
    onReviewUrl: (review: { url: string } | null) => void;
    timeoutMs?: number;
  },
): Promise<`0x${string}`> {
  const walletId = findParaSigningWallet(para, payload.signer, "evm")?.id;
  if (!walletId || !para.signTransaction)
    throw new Error("Para wallet is not available for transaction signing");
  const transaction = paraUnsignedTransaction(payload);
  const timeoutMs = options.timeoutMs ?? PARA_REVIEW_TIMEOUT_MS;
  let canceled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      canceled = true;
      reject(new ParaSigningIncompleteError("timeout"));
    }, timeoutMs + GUARD_MS);
  });
  try {
    const result = await Promise.race([
      para.signTransaction({
        walletId,
        rlpEncodedTxBase64: hexToBase64(serializeTransaction(transaction)),
        chainId: String(payload.chain_id),
        timeoutMs,
        isCanceled: () => canceled,
        onTransactionReviewUrl: (url) => options.onReviewUrl({ url }),
      }),
      guard,
    ]).catch((error: unknown) => {
      if (error instanceof ParaSigningIncompleteError) throw error;
      const pending = (error as { pendingTransactionId?: unknown })
        ?.pendingTransactionId;
      throw new ParaSigningIncompleteError(
        (error as { name?: string })?.name === "TransactionReviewTimeout"
          ? "timeout"
          : "provider_error",
        typeof pending === "string" ? pending : undefined,
        { cause: error },
      );
    });
    if (!result.signature)
      throw new ParaSigningIncompleteError(
        "no_signature",
        result.pendingTransactionId,
      );
    const normalized = (
      result.signature.startsWith("0x")
        ? result.signature
        : `0x${result.signature}`
    ) as `0x${string}`;
    const { r, s, yParity } = parseSignature(normalized);
    const signed = serializeTransaction(transaction, { r, s, yParity });
    const recovered = await recoverTransactionAddress({
      serializedTransaction: signed,
    });
    if (recovered.toLowerCase() !== payload.signer.toLowerCase())
      throw new Error(
        "Para returned a signature for a different wallet. Nothing was broadcast.",
      );
    return signed;
  } finally {
    canceled = true;
    clearTimeout(timer);
    options.onReviewUrl(null);
  }
}
