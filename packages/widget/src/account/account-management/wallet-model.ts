import type { LinkedAuthAccount } from "@/wallet/account/types";
import type { WalletFamily } from "@/wallet/types";
import type { WalletRow } from "@/wallet/composer/wallet-state";

type LoginProvider = "para" | "privy";

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

/** What an agent wallet is called where a wallet app's name would go. */
export const AGENT_WALLET = "Agent wallet";

/** The wallet app, e.g. "Rabby" or "Privy"; "Agent wallet" for an agent wallet. */
export const appName = (row: WalletRow) => {
  if (row.kind === "agent") return AGENT_WALLET;
  const provider = loginProvider(row.provider);
  return row.brand ?? (provider ? providerName(provider) : "Wallet");
};

/**
 * The row title: the user's own name for the address (with the app name
 * muted beside it), else the wallet app ("Rabby", "Privy"). An agent
 * address carries its agent wallet's name alone.
 */
export function rowTitle(row: WalletRow): { title: string; app?: string } {
  if (row.label && row.kind === "agent") return { title: row.label };
  if (row.label) return { title: row.label, app: appName(row) };
  return { title: appName(row) };
}

/** The login's email beside an embedded wallet's address. */
export const rowEmail = (row: WalletRow) =>
  row.kind !== "agent" && loginProvider(row.provider)
    ? row.loginEmail
    : undefined;

/** `1 wallet`, `2 wallets`; `words` when the plural is not just an s. */
export const plural = (count: number, word: string, words = `${word}s`) =>
  `${count} ${count === 1 ? word : words}`;

/** `EVM/SVM`, `EVM` or `SVM`: the families a set of addresses covers. */
export const familyList = (families: readonly WalletFamily[]) =>
  (["evm", "svm"] as const)
    .filter((family) => families.includes(family))
    .map(familyTag)
    .join("/");

/** What clicking a row that needs a step will do, shown on hover. */
export function pendingHint(row: WalletRow): string | null {
  if (row.pendingStep === "switch") return `Switch in ${appName(row)}`;
  if (row.pendingStep === "connect")
    return loginProvider(row.provider)
      ? `Sign in with ${appName(row)}`
      : `Connect ${appName(row)}`;
  return null;
}

/** One "signs with" slot per family; `current` is unset when it has no address. */
export function familySlots(rows: readonly WalletRow[]) {
  return (["evm", "svm"] as const).map((family) => {
    const list = rows.filter((row) => row.linked && row.family === family);
    // The one that signs now; else the chosen one, shown as waiting for its step.
    const current =
      list.find((row) => row.active) ??
      list.find((row) => row.chosen) ??
      list.find((row) => row.connected) ??
      list.at(0);
    const ordered = current
      ? [current, ...list.filter((row) => row !== current)]
      : [];
    return { family, rows: ordered, current };
  });
}

/** Group embedded addresses by their owning identity, never by provider alone. */
export function walletSections(
  rows: readonly WalletRow[],
  unlinked: WalletRow | undefined,
  signInMethods: readonly LinkedAuthAccount[],
): { wallets: WalletRow[]; logins: LoginGroup[] } {
  const groups = new Map<string, LoginGroup>();
  for (const identity of signInMethods) {
    const provider = loginProvider(identity.provider);
    if (!provider) continue;
    const key = `identity:${identity.id}`;
    groups.set(key, { key, provider, identity, rows: [] });
  }
  const wallets: WalletRow[] = [];
  for (const row of rows) {
    if (row.kind === "agent" || !row.linked) continue;
    const provider = loginProvider(row.provider);
    if (!provider) {
      wallets.push(row);
      continue;
    }
    const key = row.authIdentityId
      ? `identity:${row.authIdentityId}`
      : `provider:${provider}`;
    const group = groups.get(key);
    if (group && group.provider === provider) group.rows.push(row);
    else {
      // Old servers without ownership data remain visible without attributing
      // their addresses to an arbitrary login.
      const fallbackKey = `${key}:${provider}`;
      const fallback = groups.get(fallbackKey);
      if (fallback) fallback.rows.push(row);
      else groups.set(fallbackKey, { key: fallbackKey, provider, rows: [row] });
    }
  }
  if (unlinked) wallets.push(unlinked);
  const logins = [...groups.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort(
      (a, b) => Number(a.family === "svm") - Number(b.family === "svm"),
    ),
  }));
  return { wallets, logins };
}

export function addressSummary(rows: readonly WalletRow[]): string {
  const linked = rows.filter((row) => row.linked);
  const here = linked.filter((row) => row.connected).length;
  return `${plural(linked.length, "address", "addresses")} · ${here} on this device`;
}

/** One wallet as the account list shows it: its addresses, EVM first. */
export type WalletGroup = { title: string; rows: WalletRow[] };

/**
 * Rows grouped by wallet, the way the account list groups them: a Para or
 * Privy login's addresses together, an agent wallet's addresses (they share
 * its name) together, and a wallet app's addresses of one name together.
 * A wallet holds one address per family, so a second address of the same
 * family starts another group. Order follows the first row of each.
 */
export function walletGroups(rows: readonly WalletRow[]): WalletGroup[] {
  const groups: { key: string; rows: WalletRow[] }[] = [];
  for (const row of rows) {
    const provider =
      row.kind === "agent" ? undefined : loginProvider(row.provider);
    const key = provider
      ? `login:${provider}`
      : `${row.kind}:${row.kind === "agent" ? "" : appName(row)}:${row.label ?? ""}`;
    const group = groups.find(
      (candidate) =>
        candidate.key === key &&
        !candidate.rows.some((own) => own.family === row.family),
    );
    if (group) group.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups.map(({ key, rows: own }) => {
    const [first] = own.sort(
      (a, b) => Number(a.family === "svm") - Number(b.family === "svm"),
    );
    return {
      title:
        own.length > 1 && key.startsWith("login:")
          ? providerName(loginProvider(first!.provider)!)
          : rowTitle(first!).title,
      rows: own,
    };
  });
}
