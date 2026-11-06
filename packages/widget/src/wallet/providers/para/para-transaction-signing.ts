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
 * After asking Para to stop, how long to wait for a signature it is already
 * computing. Para checks the stop flag only between polls, so an approval
 * seen just before it can still finish its MPC signing round.
 */
export const PARA_SIGNATURE_GRACE_MS = 15_000;

/**
 * Para returned no signature to this page, so Aomi broadcast nothing. The
 * outcome is still unknown: Para's server co-signs every signature and an
 * approved review may finish signing after this page stopped waiting. Para
 * never broadcasts it. Any such signature is bound to this prepared
 * transaction's nonce, so it and a retry (which signs the same transaction,
 * same nonce) cannot both land, and it is void once that nonce is used.
 */
export class ParaSigningIncompleteError extends Error {
  /** Never proof that signing did not happen. */
  readonly outcome = "unknown" as const;
  constructor(
    readonly reason: "timeout" | "provider_error" | "no_signature",
    readonly pendingTransactionId?: string,
    options?: { cause?: unknown },
  ) {
    super(
      `${
        reason === "timeout"
          ? "Para didn't return a signature in time"
          : "Para didn't return a signature"
      }, so Aomi sent nothing. If you approved it in Para, that approval only covers this exact transaction: trying again signs the same transaction, and at most one can go through.`,
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
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  // Stop Para first, then give a signature already in flight time to arrive:
  // one that does goes through the normal store-then-broadcast path.
  const guard = new Promise<never>((_, reject) => {
    timers.push(
      setTimeout(() => {
        canceled = true;
        timers.push(
          setTimeout(
            () => reject(new ParaSigningIncompleteError("timeout")),
            PARA_SIGNATURE_GRACE_MS,
          ),
        );
      }, timeoutMs + GUARD_MS),
    );
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
    for (const timer of timers) clearTimeout(timer);
    options.onReviewUrl(null);
  }
}
