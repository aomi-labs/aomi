import type { WalletFamily } from "../types";

const STORAGE_PREFIX = "aomi.wallet.operating.v1";

export type WalletSelection = Partial<Record<WalletFamily, string>>;

export type WalletSelectionStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export function browserWalletSelectionStorage():
  | WalletSelectionStorage
  | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    // Sandboxed and privacy-restricted browsers may throw while reading the
    // localStorage property itself, before any storage method is called.
    return undefined;
  }
}

function storageKey(accountId: string, family: WalletFamily): string {
  return `${STORAGE_PREFIX}:${accountId}:${family}`;
}

export function readWalletSelection(
  storage: WalletSelectionStorage | undefined,
  accountId: string | undefined,
): WalletSelection {
  if (!storage || !accountId) return {};
  const selection: WalletSelection = {};
  for (const family of ["evm", "svm"] as const) {
    try {
      const value = storage.getItem(storageKey(accountId, family));
      if (value) selection[family] = value;
    } catch {
      // Storage is a preference only. Private browsing and quota failures must
      // not prevent the wallet state from resolving.
    }
  }
  return selection;
}

export function writeWalletSelection(
  storage: WalletSelectionStorage | undefined,
  accountId: string | undefined,
  family: WalletFamily,
  walletKey: string | undefined,
): void {
  if (!storage || !accountId) return;
  try {
    if (walletKey) storage.setItem(storageKey(accountId, family), walletKey);
    else storage.removeItem(storageKey(accountId, family));
  } catch {
    // See readWalletSelection: failure falls back to the deterministic sole-
    // eligible-wallet rule in the resolver.
  }
}
