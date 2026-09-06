import type {
  AccountWallet,
  AomiAccount,
  LinkedAuthAccount,
} from "@aomi-labs/widget-lib";
import type { WalletPolicy } from "./types";

export type UnifiedAccountWallet = {
  key: string;
  family: "evm" | "svm";
  address: string;
  chainId?: number;
  walletName?: string;
  label?: string;
  provider?: string;
  kind?: "external" | "embedded" | "smart_account";
  connected: boolean;
  linked: boolean;
  active: boolean;
  connectedAccountId?: string;
  accountWalletId?: string;
  policy?: WalletPolicy;
};

export type LiveWalletConnection = {
  id: string;
  family: "evm" | "svm";
  address: string;
  chainId?: number;
  walletName?: string;
  provider?: string;
  active: boolean;
};

export type WalletManagementInput = {
  accounts: readonly AomiAccount[];
  linkedWallets: readonly AccountWallet[];
  policies: readonly WalletPolicy[];
  liveConnections?: readonly LiveWalletConnection[];
};

function walletKey(family: "evm" | "svm", address: string): string {
  return `${family}:${family === "evm" ? address.toLowerCase() : address}`;
}

export function buildUnifiedAccountWallets({
  accounts,
  linkedWallets,
  policies,
  liveConnections = [],
}: WalletManagementInput): UnifiedAccountWallet[] {
  const rows = new Map<string, UnifiedAccountWallet>();

  for (const wallet of linkedWallets) {
    const key = walletKey(wallet.family, wallet.address);
    rows.set(key, {
      key,
      family: wallet.family,
      address: wallet.address,
      walletName: wallet.label,
      label: wallet.label,
      provider: wallet.provider,
      kind: wallet.kind,
      connected: false,
      linked: true,
      active: false,
      accountWalletId: wallet.id,
    });
  }

  for (const policy of policies) {
    const key = walletKey(policy.chain, policy.address);
    const current = rows.get(key);
    rows.set(key, {
      key,
      family: policy.chain,
      address: current?.address ?? policy.address,
      walletName: current?.walletName,
      label: current?.label,
      provider: current?.provider ?? policy.provider,
      kind:
        current?.kind ??
        (policy.linkedVia === "para" || policy.linkedVia === "privy"
          ? "embedded"
          : "external"),
      connected: current?.connected ?? false,
      linked: true,
      active: current?.active ?? false,
      connectedAccountId: current?.connectedAccountId,
      accountWalletId: current?.accountWalletId,
      policy,
    });
  }

  // Account linking refreshes the durable account graph and can briefly leave
  // `accounts` empty while the wallet registry is still live. Merge that live
  // connection explicitly so a connected wallet never collapses into a
  // linked-only row during the session transition.
  for (const connection of liveConnections) {
    const key = walletKey(connection.family, connection.address);
    const current = rows.get(key);
    rows.set(key, {
      key,
      family: connection.family,
      address: connection.address,
      chainId: connection.chainId ?? current?.chainId,
      walletName: connection.walletName ?? current?.walletName,
      label: current?.label,
      provider: connection.provider ?? current?.provider,
      kind: current?.kind ?? "external",
      connected: true,
      linked: current?.linked ?? false,
      active: connection.active,
      connectedAccountId: connection.id,
      accountWalletId: current?.accountWalletId,
      policy: current?.policy,
    });
  }

  for (const account of accounts) {
    if (!account.address) continue;
    const key = walletKey(account.family, account.address);
    const current = rows.get(key);
    rows.set(key, {
      key,
      family: account.family,
      address: account.address,
      chainId: account.chainId ?? current?.chainId,
      walletName: account.walletName ?? current?.walletName,
      label: account.label ?? current?.label,
      provider: account.provider ?? current?.provider,
      kind: account.walletKind ?? current?.kind ?? "external",
      connected: true,
      linked: Boolean(account.linked || current?.linked),
      active: account.active,
      connectedAccountId: account.id,
      accountWalletId: current?.accountWalletId,
      policy: current?.policy,
    });
  }

  // Map insertion order follows the durable linked-wallet list, then appends
  // wallets first observed from policy or live runtimes. Do not sort on active
  // state: selecting another wallet should update its state in place rather
  // than making rows jump around underneath the pointer.
  return [...rows.values()];
}

export function walletConnectionSummary(
  wallets: readonly UnifiedAccountWallet[],
): string {
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
      account.provider !== "wallet" &&
      account.provider !== "siwe" &&
      account.provider !== "siws",
  );
}

export function isProviderSigningWallet(wallet: WalletPolicy): boolean {
  return wallet.linkedVia === "para" || wallet.linkedVia === "privy";
}
