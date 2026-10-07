import type { LinkedAuthAccount } from "@/wallet/account/types";
import type { WalletRow } from "@/wallet/composer/wallet-state";
export {
  accountDisplayName,
  providerEmailDisplayHint,
} from "@/wallet/account/display";
import type { WalletPolicy } from "@/account/types";

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
