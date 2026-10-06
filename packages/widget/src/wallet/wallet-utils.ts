"use client";

import type { PublicWalletFamily, WalletFamily } from "./types";

export function normalizeWalletAddress(
  family: WalletFamily,
  address: string,
): string {
  const trimmed = address.trim();
  return family === "evm" ? trimmed.toLowerCase() : trimmed;
}

export function walletKey(family: WalletFamily, address: string): string {
  return `${family}:${normalizeWalletAddress(family, address)}`;
}

export function toRegistryFamily(
  family: PublicWalletFamily | undefined,
  fallback: WalletFamily = "evm",
): WalletFamily {
  if (!family) return fallback;
  return family;
}

/**
 * Whether a connected wallet can be linked by signing the link challenge.
 * Embedded and smart-account Solana wallets cannot: the account service only
 * accepts a Solana link from an external signer.
 */
export function canLinkWalletBySignature(
  family: WalletFamily,
  kind: "external" | "embedded" | "smart_account" | undefined,
): boolean {
  return (
    family === "evm" ||
    (family === "svm" && kind !== "embedded" && kind !== "smart_account")
  );
}
