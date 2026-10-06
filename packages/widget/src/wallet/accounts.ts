"use client";

import { formatWalletAddress } from "./identity";
import type { AomiAccount } from "./types";
import { walletKey } from "./wallet-utils";
import type { AccountWallet } from "./account/types";

export type EvmConnectionInput = {
  id: string;
  walletName: string;
  address: string;
  chainId?: number;
  provider?: string;
  walletKind?: AomiAccount["walletKind"];
};

export type SvmConnectionInput = {
  id?: string;
  publicKey: string;
  walletName?: string;
  provider?: string;
  walletKind?: AomiAccount["walletKind"];
};

const GENERIC_WALLET_NAMES = new Set(["", "injected", "browser wallet", "wallet"]);

/** A real brand name beats a generic injected label when picking the display row. */
function isRealBrandName(name: string | undefined): boolean {
  return !GENERIC_WALLET_NAMES.has((name ?? "").trim().toLowerCase());
}

export function buildAccounts(input: {
  evmConnections: readonly EvmConnectionInput[];
  activeEvmAddress?: string;
  activeEvmConnectionId?: string;
  svmConnections?: readonly SvmConnectionInput[];
  activeSvmAddress?: string;
}): AomiAccount[] {
  const accounts: AomiAccount[] = [];
  const active = input.activeEvmAddress
    ? walletKey("evm", input.activeEvmAddress)
    : undefined;
  const activeConnId = input.activeEvmConnectionId;

  // Group EVM connections by lowercased address so one address yields one row,
  // regardless of how many connectors expose it (e.g. Rabby impersonating
  // MetaMask via EIP-6963). Preserve first-seen order.
  const evmGroups = new Map<string, EvmConnectionInput[]>();
  for (const conn of input.evmConnections) {
    const key = walletKey("evm", conn.address);
    const group = evmGroups.get(key);
    if (group) group.push(conn);
    else evmGroups.set(key, [conn]);
  }

  for (const [lowerAddr, conns] of evmGroups) {
    const activeConn = activeConnId
      ? conns.find((c) => c.id === activeConnId)
      : undefined;
    const display =
      activeConn ??
      conns.find((c) => isRealBrandName(c.walletName)) ??
      conns[0];
    const isActive = activeConnId
      ? conns.some((c) => c.id === activeConnId)
      : !!active && lowerAddr === active;

    accounts.push({
      id: (activeConn ?? display).id,
      family: "evm",
      address: display.address,
      label: formatWalletAddress(display.address),
      walletName: display.walletName,
      chainId: display.chainId,
      provider: display.provider,
      walletKind: display.walletKind,
      connectorIds: conns.map((c) => c.id),
      active: isActive,
    });
  }

  const seenSvm = new Set<string>();
  for (const connection of input.svmConnections ?? []) {
    const key = walletKey("svm", connection.publicKey);
    if (seenSvm.has(key)) continue;
    seenSvm.add(key);
    accounts.push({
      id: connection.id ?? connection.walletName ?? connection.publicKey,
      family: "svm",
      address: connection.publicKey,
      label: formatWalletAddress(connection.publicKey),
      walletName: connection.walletName,
      provider: connection.provider,
      walletKind: connection.walletKind,
      active: connection.publicKey === input.activeSvmAddress,
    });
  }

  return accounts;
}

export function buildWalletKitAccounts({
  accounts,
  accountWallets = [],
  transformAccounts,
  canManageAccount,
}: {
  accounts: AomiAccount[];
  accountWallets?: readonly AccountWallet[];
  transformAccounts?: (accounts: AomiAccount[]) => AomiAccount[];
  canManageAccount?: (account: AomiAccount) => boolean;
}): AomiAccount[] {
  const linked = applyStoredWalletLinks(accounts, accountWallets);
  const transformed = transformAccounts ? transformAccounts(linked) : linked;
  if (!canManageAccount) return transformed;
  return transformed.map((account) =>
    canManageAccount(account) ? { ...account, manageable: true } : account,
  );
}

function applyStoredWalletLinks(
  accounts: AomiAccount[],
  wallets: readonly AccountWallet[],
): AomiAccount[] {
  if (wallets.length === 0) return accounts;
  const storedByKey = new Map(
    wallets.map((wallet) => [walletKey(wallet.family, wallet.address), wallet]),
  );
  return accounts.map((account) => {
    const stored = storedByKey.get(walletKey(account.family, account.address));
    if (!stored) return account;
    return {
      ...account,
      linked: true,
      linkedVia: stored.linkedVia,
      capability: stored.capability,
    };
  });
}
