import { SUPPORTED_CHAIN_IDS, CHAIN_NAMES } from "../chains";
import type { AAMode } from "../aa/types";
import type { CliAAProvider, CliPaymentMethod } from "./types";
import type { AomiInferenceFundingSource } from "../agent/types";
import { fatal } from "./errors";
import { parseSolanaKeypairSecret } from "./solana-signer";

const EVM_PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function parseChainId(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return undefined;
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

export function parseAAProvider(
  value: string | undefined,
): CliAAProvider | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (value === "alchemy" || value === "pimlico") {
    return value;
  }
  fatal("Unsupported AA provider. Use `alchemy` or `pimlico`.");
}

export function parseAAMode(value: string | undefined): AAMode | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (value === "4337" || value === "7702") {
    return value;
  }
  fatal("Unsupported AA mode. Use `4337` or `7702`.");
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

export function parseInferenceFunding(
  value: string | undefined,
): AomiInferenceFundingSource | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "user_byok") {
    return normalized;
  }
  fatal("Unsupported inference funding. Use `user_byok`.");
}
