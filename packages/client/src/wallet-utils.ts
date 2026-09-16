// =============================================================================
// Wallet adapter payloads
// =============================================================================
//
// These types belong to wallet-kit adapters. Public runtime orchestration uses
// Action, ActionRequest, and ActionResult instead.

// =============================================================================
// Types
// =============================================================================

import { type Hex } from "viem";
import type { AAWalletCall } from "./aa/types";

export type WalletTxAaPreference = "auto" | "eip4337" | "eip7702" | "none";

export type WalletTxCallPayload = {
  txId: number;
  to: string;
  value?: string;
  data?: string;
  chainId?: number;
  from?: string;
  gas?: string;
  description?: string;
};

export type WalletTxPayload = {
  to?: string;
  value?: string;
  data?: string;
  chainId?: number;
  txId?: number;
  txIds?: number[];
  aaPreference?: WalletTxAaPreference;
  aaStrict?: boolean;
  requestId?: string;
  calls?: WalletTxCallPayload[];
};

export type WalletEip712Payload = {
  /** Stable public Agent action id when projected from the canonical API. */
  requestId?: string;
  typed_data?: {
    domain?: { chainId?: number | string };
    types?: Record<string, Array<{ name: string; type: string }>>;
    primaryType?: string;
    message?: Record<string, unknown>;
  };
  non_typed_data?: string;
  description?: string;
  eip712Id?: number;
  /** Expected EOA for an opaque signing request. */
  signer?: string;
  /** Requested EVM chain when the signature is execution-bound. */
  chainId?: number;
};

/**
 * Wallet-kit payload carrying a serialized Solana transaction.
 *
 * `unsignedTx` is base64 of `VersionedTransaction.serialize()` (legacy
 * `Transaction.serialize()` also accepted by adapters). The host doesn't
 * decode it; the wallet adapter handles deserialization.
 */
export type WalletSolanaSignPayload = {
  /** Stable public Agent action id when projected from the canonical API. */
  requestId?: string;
  /** Base64 of the unsigned Solana transaction. */
  unsignedTx?: string;
  /** Human-readable summary shown alongside the wallet's decoded preview. */
  description?: string;
  /** CAIP-2 cluster string (`"solana:mainnet"` / `"solana:devnet"`). */
  cluster?: string;
  /** Server-side correlation id for the staged sign request. */
  pendingSolanaId?: number;
  /** Staged instruction identifiers covered by this wallet-kit operation. */
  pendingSolanaIds?: number[];
  /** Canonical multi-leg Agent action, in execution order. */
  transactions?: Array<{
    id: string;
    unsignedTx: string;
    description?: string;
  }>;
};

export type WalletSolanaSignMessagePayload = {
  /** Stable public Agent action id when projected from the canonical API. */
  requestId?: string;
  /** Base64 of the raw message bytes to sign. */
  message?: string;
  /** Human-readable summary shown alongside the wallet's decoded preview. */
  description?: string;
  /** CAIP-2 cluster string (`"solana:mainnet"` / `"solana:devnet"`). */
  cluster?: string;
  /** Server-side correlation id for the staged sign request. */
  pendingSolanaId?: number;
};

export type ViemSignTypedDataArgs = {
  domain?: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message?: Record<string, unknown>;
};

export type ViemSignMessageArgs = {
  message: string | { raw: Hex };
};

// =============================================================================
// Helpers
// =============================================================================

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as UnknownRecord;
}

/**
 * Normalize Solana's legacy cluster labels to the CAIP-style identifiers used
 * by the wallet runtime. Preserve unknown labels so callers can surface a
 * useful unsupported-cluster error instead of silently changing networks.
 */
export function normalizeSolanaCluster(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  switch (trimmed.toLowerCase()) {
    case "mainnet":
    case "mainnet-beta":
    case "solana:mainnet":
    case "solana:mainnet-beta":
      return "solana:mainnet";
    case "devnet":
    case "solana:devnet":
      return "solana:devnet";
    case "testnet":
    case "solana:testnet":
      return "solana:testnet";
    default:
      return trimmed;
  }
}

export function parseChainId(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parsed = trimmed.startsWith("0x")
    ? parseCanonicalInteger(trimmed.slice(2), 16)
    : parseCanonicalInteger(trimmed, 10);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function parseCanonicalInteger(
  value: string,
  radix: 10 | 16,
): number | undefined {
  if (value === "") return undefined;
  const pattern = radix === 16 ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/;
  if (!pattern.test(value)) return undefined;

  const parsed = Number.parseInt(value, radix);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isHexBytes(value: string): value is Hex {
  return /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
}

/**
 * Convert a normalized WalletTxPayload into AAWalletCalls.
 * This is the single boundary conversion point from backend payloads to AA-ready calls.
 */
export function toAAWalletCalls(
  payload: WalletTxPayload,
  defaultChainId = 1,
): AAWalletCall[] {
  const calls = payload.calls?.length
    ? payload.calls
    : payload.to
      ? [
          {
            txId: payload.txId ?? 0,
            to: payload.to,
            value: payload.value,
            data: payload.data,
            chainId: payload.chainId,
          } satisfies WalletTxCallPayload,
        ]
      : [];
  if (calls.length === 0) {
    throw new Error("pending_transaction_missing_call_data");
  }
  return calls.map((call) => ({
    to: call.to as Hex,
    value: BigInt(call.value ?? "0"),
    data: call.data ? (call.data as Hex) : undefined,
    chainId: call.chainId ?? payload.chainId ?? defaultChainId,
  }));
}

export function toAAWalletCall(
  payload: WalletTxPayload,
  defaultChainId = 1,
): AAWalletCall {
  return toAAWalletCalls(payload, defaultChainId)[0];
}

/**
 * Convert normalized EIP-712 payloads into the viem signing shape used by both
 * the CLI and widget component layers.
 */
export function toViemSignTypedDataArgs(
  payload: WalletEip712Payload,
): ViemSignTypedDataArgs | null {
  const typedData = payload.typed_data;
  const primaryType =
    typeof typedData?.primaryType === "string" &&
    typedData.primaryType.trim().length > 0
      ? typedData.primaryType
      : undefined;

  if (!typedData || !primaryType) {
    return null;
  }

  return {
    domain: asRecord(typedData.domain),
    types: Object.fromEntries(
      Object.entries(typedData.types ?? {}).filter(
        ([typeName]) => typeName !== "EIP712Domain",
      ),
    ) as ViemSignTypedDataArgs["types"],
    primaryType,
    message: asRecord(typedData.message),
  };
}

/**
 * Convert normalized ERC-191/personal_sign payloads into viem signMessage args.
 * Hex strings are opaque bytes; all other strings are signed as UTF-8 text.
 */
export function toViemSignMessageArgs(
  payload: WalletEip712Payload,
): ViemSignMessageArgs | null {
  const nonTypedData = payload.non_typed_data;
  if (typeof nonTypedData !== "string" || nonTypedData.length === 0) {
    return null;
  }

  return {
    message: isHexBytes(nonTypedData) ? { raw: nonTypedData } : nonTypedData,
  };
}
