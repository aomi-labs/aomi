import { SUPPORTED_CHAIN_IDS, CHAIN_NAMES } from "@aomi-labs/client";
import type { CliPaymentMethod } from "./types";
import { fatal } from "./errors";
import { parseSolanaKeypairSecret } from "./solana-signer";

const EVM_PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function parseChainId(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // parseInt would read "8453abc" as 8453 and "base" as NaN (dropped silently).
  if (!/^\d+$/.test(trimmed)) {
    fatal(`Invalid chain ID "${value}". Use a decimal chain ID, such as 8453.`);
  }
  const n = Number(trimmed);
  if (!(SUPPORTED_CHAIN_IDS as readonly number[]).includes(n)) {
    const list = SUPPORTED_CHAIN_IDS.map(
      (id) => `  ${id} (${CHAIN_NAMES[id]})`,
    ).join("\n");
    fatal(`Unsupported chain ID: ${n}\nSupported chains:\n${list}`);
  }
  return n;
}

export function normalizePrivateKey(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!EVM_PRIVATE_KEY_PATTERN.test(trimmed)) {
    fatal("Invalid private key. Expected a 0x-prefixed 32-byte hex string.");
  }
  return trimmed;
}

export function validateSolanaPrivateKey(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    parseSolanaKeypairSecret(trimmed);
  } catch (err) {
    fatal(
      `Invalid Solana private key: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return trimmed;
}

export function parsePaymentMethod(
  value: string | undefined,
): CliPaymentMethod | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "coinbase") {
    return normalized;
  }
  fatal("Unsupported payment method. Use `coinbase`.");
}
