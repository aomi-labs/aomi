"use client";

/**
 * Wallet branding shared by catalogs and runtime adapters.
 *
 * Runtime-specific detection stays in its runtime folder; this module only owns
 * stable brand keys and string normalization.
 */

export function normalizeWalletOptionId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type WalletBrandDescriptor = {
  key: string;
  matchers: readonly string[];
};

const providerBrandRegistry: WalletBrandDescriptor[] = [];

/**
 * Let a provider plugin contribute its own canonical brand key (e.g. Para)
 * without the generic resolver hardcoding the provider name.
 */
export function registerWalletBrand(descriptor: WalletBrandDescriptor): void {
  if (!providerBrandRegistry.some((entry) => entry.key === descriptor.key)) {
    providerBrandRegistry.push(descriptor);
  }
}

/**
 * Collapse ids/labels/rdns strings onto one canonical brand key so the same
 * wallet matches across connectors, accounts, icons and dedupe sets.
 */
export function canonicalWalletKey(value: string): string {
  const normalized = normalizeWalletOptionId(value);
  for (const brand of providerBrandRegistry) {
    if (brand.matchers.some((matcher) => normalized.includes(matcher))) {
      return brand.key;
    }
  }
  if (normalized.includes("metamask")) return "metamask";
  if (normalized.includes("rabby")) return "rabby";
  if (normalized.includes("coinbase")) return "coinbase";
  if (normalized.includes("rainbow")) return "rainbow";
  if (normalized.includes("walletconnect")) return "walletconnect";
  if (normalized.includes("baseaccount") || normalized === "base") {
    return "base";
  }
  if (normalized.includes("phantom")) return "phantom";
  if (normalized.includes("solflare")) return "solflare";
  if (normalized.includes("backpack")) return "backpack";
  if (normalized.includes("glow")) return "glow";
  return normalized;
}
