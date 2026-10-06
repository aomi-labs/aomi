import { brandDisplayName } from "../runtime/evm/brands";
import type { AomiAccount, WalletFamily } from "../types";
import type { AccountWallet } from "./types";

export function walletAccountKey(
  family: WalletFamily,
  address: string,
): string {
  return family === "evm"
    ? `${family}:${address.toLowerCase()}`
    : `${family}:${address}`;
}

export function normalizeAccountWalletProvider(
  wallet: AccountWallet,
  liveAccounts: readonly Pick<
    AomiAccount,
    "family" | "address" | "provider" | "walletKind"
  >[],
): AccountWallet {
  const liveAccount = liveAccounts.find(
    (account) =>
      account.family === wallet.family &&
      walletAccountKey(account.family, account.address) ===
        walletAccountKey(wallet.family, wallet.address),
  );
  const provider = liveAccount?.provider;
  const walletKind = liveAccount?.walletKind;
  if (
    provider &&
    walletKind &&
    walletKind !== "embedded" &&
    walletKind !== "smart_account"
  ) {
    return wallet;
  }
  const inferredProvider =
    provider ?? providerLinkedWalletVia(wallet.linkedVia);
  if (!inferredProvider) return wallet;

  return {
    ...wallet,
    provider: wallet.provider ?? inferredProvider,
    kind:
      walletKind === "embedded" || walletKind === "smart_account"
        ? walletKind
        : (wallet.kind ?? "embedded"),
  };
}

function providerLinkedWalletVia(linkedVia: AccountWallet["linkedVia"]) {
  if (
    linkedVia === "siwe" ||
    linkedVia === "siws" ||
    linkedVia === "challenge" ||
    linkedVia === "import" ||
    linkedVia === "observed" ||
    linkedVia === "migration"
  ) {
    return null;
  }
  return linkedVia;
}

/**
 * Resolve the brand name of the wallet being linked from the live EVM accounts,
 * matching by stable account id first and address second. Falls back to the
 * caller-supplied active-connection name only when the linked wallet isn't in
 * the live set — so a default label is always brand-correct for the wallet the
 * user actually picked, even when a different wallet is the active signer.
 */
export function resolveLinkedWalletName(input: {
  accounts: ReadonlyArray<{
    id: string;
    address?: string;
    walletName?: string;
  }>;
  accountId?: string;
  address: string;
  fallbackWalletName?: string;
}): string | undefined {
  const target = input.address.toLowerCase();
  const match = input.accounts.find(
    (candidate) =>
      (input.accountId !== undefined && candidate.id === input.accountId) ||
      candidate.address?.toLowerCase() === target,
  );
  return match?.walletName ?? input.fallbackWalletName;
}

/**
 * Build a first-link default label like "Rabby 1" / "MetaMask 2" so the
 * account-management row is never blank before the user renames it. Only used
 * as the initial value — the account service persists labels as
 * `auth_providers.provider_metadata.display_label` and keeps the stored one on
 * re-link, so user renames stick.
 */
export function buildDefaultWalletLabel(input: {
  walletName?: string | null;
  existingWallets: readonly AccountWallet[];
  family: WalletFamily;
}): string {
  const brand = brandDisplayName(input.walletName);
  const sameBrand = input.existingWallets.filter(
    (wallet) =>
      wallet.family === input.family &&
      wallet.label?.toLowerCase().startsWith(brand.toLowerCase()),
  ).length;
  return `${brand} ${sameBrand + 1}`;
}
