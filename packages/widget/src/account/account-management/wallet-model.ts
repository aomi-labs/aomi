import type { LinkedAuthAccount } from "@/wallet/account/types";
import type { WalletFamily } from "@/wallet/types";
import type { WalletRow } from "@/wallet/composer/wallet-state";

export type LoginProvider = "para" | "privy";

export type LoginGroup = {
  key: string;
  provider: LoginProvider;
  identity?: LinkedAuthAccount;
  rows: WalletRow[];
};

export function loginProvider(value?: string): LoginProvider | undefined {
  const provider = value?.toLowerCase();
  return provider === "para" || provider === "privy" ? provider : undefined;
}

export const providerName = (provider: LoginProvider) =>
  provider === "para" ? "Para" : "Privy";

export const familyTag = (family: WalletFamily) =>
  family === "evm" ? "EVM" : "SVM";

/** The wallet app, e.g. "Rabby" or "Privy". */
export const appName = (row: WalletRow) => row.brand ?? "Wallet";

/** The row title, and the app name shown muted beside a user's own name. */
export function rowTitle(row: WalletRow): { title: string; app?: string } {
  const embedded = Boolean(loginProvider(row.provider));
  if (row.label) return { title: row.label, app: appName(row) };
  return { title: embedded ? `${familyTag(row.family)} wallet` : appName(row) };
}

/** What clicking a row that needs a step will do, shown on hover. */
export function pendingHint(row: WalletRow): string | null {
  if (row.pendingStep === "switch") return `Switch in ${appName(row)}`;
  if (row.pendingStep === "connect") return `Connect ${appName(row)}`;
  return null;
}

/** One "signs with" slot per family; `current` is unset when it has no address. */
export function familySlots(rows: readonly WalletRow[]) {
  return (["evm", "svm"] as const).map((family) => {
    const list = rows.filter((row) => row.linked && row.family === family);
    const ordered = [
      ...list.filter((row) => row.active),
      ...list.filter((row) => !row.active),
    ];
    // The chosen address, or the one left when it was removed.
    return { family, rows: ordered, current: ordered.at(0) };
  });
}

/**
 * Wallets (linked external addresses, then the one waiting to be verified), then one
 * group per Para or Privy login with its addresses. The account graph does
 * not say which login owns an embedded address, so a provider's addresses
 * sit under its first login.
 */
export function walletSections(
  rows: readonly WalletRow[],
  unlinked: WalletRow | undefined,
  signInMethods: readonly LinkedAuthAccount[],
): { wallets: WalletRow[]; logins: LoginGroup[] } {
  const byProvider = new Map<LoginProvider, WalletRow[]>();
  const wallets: WalletRow[] = [];
  for (const row of rows) {
    const provider = loginProvider(row.provider);
    if (!provider) {
      if (row.linked) wallets.push(row);
      continue;
    }
    if (row.linked)
      byProvider.set(provider, [...(byProvider.get(provider) ?? []), row]);
  }
  if (unlinked) wallets.push(unlinked);
  const familyFirst = (list: WalletRow[] = []) =>
    [...list].sort(
      (a, b) => Number(a.family === "svm") - Number(b.family === "svm"),
    );
  const logins: LoginGroup[] = [];
  for (const identity of signInMethods) {
    const provider = loginProvider(identity.provider);
    if (!provider) continue;
    logins.push({
      key: `identity:${identity.id}`,
      provider,
      identity,
      rows: familyFirst(byProvider.get(provider)),
    });
    byProvider.delete(provider);
  }
  for (const [provider, list] of byProvider) {
    logins.push({
      key: `provider:${provider}`,
      provider,
      rows: familyFirst(list),
    });
  }
  return { wallets, logins };
}

export function addressSummary(rows: readonly WalletRow[]): string {
  const linked = rows.filter((row) => row.linked);
  const here = linked.filter((row) => row.connected).length;
  return `${linked.length} ${linked.length === 1 ? "address" : "addresses"} · ${here} on this device`;
}
