import {
  type LinkedAuthAccount,
  type AomiUserRef,
} from "@/wallet/account/types";
import { type WalletRow } from "@/wallet/composer/wallet-state";
import { type WalletPolicy } from "@/account/types";
import { type AomiSessionIdentity } from "@/wallet/types";

export function walletConnectionSummary(wallets: readonly WalletRow[]): string {
  const linked = wallets.filter((wallet) => wallet.linked);
  const linkedOffline = linked.filter((wallet) => !wallet.connected).length;

  if (linked.length > 0) {
    const linkedLabel = `${linked.length} linked ${
      linked.length === 1 ? "wallet" : "wallets"
    }`;
    if (linkedOffline > 0) {
      return `${linkedLabel} · ${linkedOffline} not connected on this device`;
    }
    return `${linkedLabel} · all connected on this device`;
  }

  const connected = wallets.filter((wallet) => wallet.connected).length;
  if (connected > 0) {
    return `${connected} ${connected === 1 ? "wallet" : "wallets"} connected on this device`;
  }
  return "No wallets linked yet";
}

export function visibleSignInMethods(
  accounts: readonly LinkedAuthAccount[],
): LinkedAuthAccount[] {
  return accounts.filter(
    (account) =>
      account.provider !== "better_auth" &&
      account.provider !== "email" &&
      account.provider !== "wallet" &&
      account.provider !== "siwe" &&
      account.provider !== "siws",
  );
}

export function isProviderSigningWallet(wallet: WalletPolicy): boolean {
  return wallet.linkedVia === "para" || wallet.linkedVia === "privy";
}

/** Wallets set to auto-signing whose delegated account is missing or expired. */
export function countDriftedWallets(wallets: WalletPolicy[]): number {
  return wallets.filter(
    (wallet) => wallet.desiredMode === "auto" && !wallet.delegationActive,
  ).length;
}

/** A session label can help display this account, but never changes its identity. */
export function providerEmailDisplayHint(
  identity: AomiSessionIdentity,
  accounts: readonly LinkedAuthAccount[],
): string | undefined {
  const provider = identity.sessionProvider;
  const subject = identity.walletProviderSubject;
  const label = identity.primaryLabel?.trim();
  if (
    identity.status !== "connected" ||
    (provider !== "privy" && provider !== "para") ||
    !subject ||
    !label ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(label)
  ) {
    return undefined;
  }
  return accounts.some(
    (account) => account.provider === provider && account.subject === subject,
  )
    ? label
    : undefined;
}

/** Prefer a chosen account name, then account email, then a verified session display hint. */
export function accountDisplayName(
  user: AomiUserRef | undefined,
  displayEmailHint?: string,
): string {
  const generatedProviderName = /^(privy|para) user$/i.test(
    user?.displayName?.trim() ?? "",
  );
  const email =
    user?.email &&
    !/^0x[a-f0-9]{40}@aomi\.dev$/i.test(user.email) &&
    !/@auth\.aomi\.local$/i.test(user.email)
      ? user.email
      : undefined;
  return (
    (!generatedProviderName ? user?.displayName : undefined) ??
    email ??
    (generatedProviderName ? displayEmailHint : undefined) ??
    "Aomi account"
  );
}
