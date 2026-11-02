import type { WalletFamily } from "../types";

export function normalizeWalletAddress(
  family: WalletFamily,
  address: string,
): string {
  const trimmed = address.trim();
  return family === "evm" ? trimmed.toLowerCase() : trimmed;
}

/** `0x1234…abcd`, for display names and redacted diagnostics. */
export function shortAddress(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}
