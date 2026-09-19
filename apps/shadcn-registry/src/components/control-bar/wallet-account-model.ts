import { formatWalletProvider } from "../../lib/wallet-kit";
import { getWalletProvider } from "../../lib/wallet-kit/providers/plugin-registry";
import type { AomiWalletKit, WalletFamily } from "../../lib/wallet-kit/types";
import type { WalletRow } from "../../lib/wallet-kit/composer/wallet-state";

export type WalletModalRow = WalletRow;
export type LinkedAccountRow = NonNullable<
  AomiWalletKit["accountLinkedAccounts"]
>[number];
export type LinkedWalletRow = NonNullable<
  AomiWalletKit["accountWallets"]
>[number];

export type AccountAccessEntries = {
  providerAccounts: ProviderAccountAccessGroup[];
  standaloneAccounts: LinkedAccountRow[];
  standaloneWallets: LinkedWalletRow[];
};

export type ProviderAccountAccessGroup = {
  key: string;
  provider: string;
  accounts: LinkedAccountRow[];
  wallets: LinkedWalletRow[];
};

const FAMILY_ORDER: Record<string, number> = { evm: 0, svm: 1 };

export function familyLabel(family: WalletFamily): string {
  return family === "svm" ? "Solana" : "Ethereum";
}

export function familyRank(family: WalletFamily): number {
  return FAMILY_ORDER[family] ?? 2;
}

export function sameWalletAddress(
  family: WalletFamily,
  left?: string,
  right?: string,
): boolean {
  if (!left || !right) return false;
  return family === "evm"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export function providerBackedAccountProvider(input: {
  provider?: string;
  kind?: string;
  linkedVia?: string;
  walletKind?: string;
  source?: string;
}): string | null {
  if (!input.provider) return null;
  if (input.linkedVia === "siwe" || input.linkedVia === "siws") return null;
  const walletKind = input.walletKind ?? input.kind;
  if (walletKind === "embedded" || walletKind === "smart_account") {
    return input.provider;
  }
  if (input.source === "live" && walletKind == null) return input.provider;
  return input.source === "embedded" ? input.provider : null;
}

/**
 * A provider id is a "provider auth" provider (embedded-wallet/social account,
 * e.g. Para or Privy) when its registered plugin declares an `authMode`. Derive
 * this from the plugin registry rather than hardcoding provider literals, so
 * shared UI stays descriptor-agnostic and new providers work without edits.
 */
export function isProviderAuthProvider(provider?: string): boolean {
  const normalizedProvider = provider?.trim().toLowerCase();
  if (!normalizedProvider) return false;
  return Boolean(getWalletProvider(normalizedProvider)?.authMode);
}

export function providerBackedWalletTitle(input: {
  provider?: string;
  walletName?: string;
  family: WalletFamily;
  kind?: string;
  walletKind?: string;
  source?: string;
}): string {
  const provider = providerBackedAccountProvider(input);
  return provider !== null
    ? (formatWalletProvider(provider) ?? provider)
    : (input.walletName ?? familyLabel(input.family));
}

export function buildAccountAccessEntries(
  linkedAccounts: readonly LinkedAccountRow[],
  wallets: readonly LinkedWalletRow[],
): AccountAccessEntries {
  const providerAccounts = new Map<string, ProviderAccountAccessGroup>();
  const standaloneAccounts: LinkedAccountRow[] = [];

  for (const account of linkedAccounts) {
    const provider = account.provider.trim().toLowerCase();
    if (!isProviderAuthProvider(provider)) {
      standaloneAccounts.push(account);
      continue;
    }
    const group = providerAccounts.get(provider) ?? {
      key: `provider:${provider}`,
      provider,
      accounts: [],
      wallets: [],
    };
    group.accounts.push(account);
    providerAccounts.set(provider, group);
  }

  const standaloneWallets: LinkedWalletRow[] = [];
  for (const wallet of wallets) {
    // `providerBackedAccountProvider` returns `string | null`, so the optional
    // chain yields `string | undefined` — a `null` check here is unreachable.
    const provider = providerBackedAccountProvider(wallet)
      ?.trim()
      .toLowerCase();
    if (provider === undefined) {
      standaloneWallets.push(wallet);
      continue;
    }
    if (!isProviderAuthProvider(provider)) continue;

    const group = providerAccounts.get(provider) ?? {
      key: `provider:${provider}`,
      provider,
      accounts: [],
      wallets: [],
    };
    const walletKey = `${wallet.family}:${
      wallet.family === "evm" ? wallet.address.toLowerCase() : wallet.address
    }`;
    const alreadyIncluded = group.wallets.some((candidate) => {
      const candidateKey = `${candidate.family}:${
        candidate.family === "evm"
          ? candidate.address.toLowerCase()
          : candidate.address
      }`;
      return candidateKey === walletKey;
    });
    if (!alreadyIncluded) group.wallets.push(wallet);
    providerAccounts.set(provider, group);
  }

  return {
    providerAccounts: [...providerAccounts.values()],
    standaloneAccounts,
    standaloneWallets,
  };
}
