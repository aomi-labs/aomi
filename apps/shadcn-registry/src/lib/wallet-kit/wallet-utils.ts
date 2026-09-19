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
