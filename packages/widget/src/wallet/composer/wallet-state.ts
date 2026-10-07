import type { AomiAccountAction, WalletFamily } from "@/wallet/types";
import { walletKey } from "@/wallet/wallet-utils";
import { formatWalletProvider } from "@/wallet/identity";
import { brandDisplayName } from "@/wallet/runtime/evm/brands";

type WalletKind = "external" | "embedded";

/** A wallet the account owns, from the account graph. */
export type LinkedWalletFact = {
  id: string;
  family: WalletFamily;
  address: string;
  kind?: WalletKind;
  provider?: string;
  chainId?: number;
  label?: string;
  walletApp?: string;
  capability?: "read" | "write";
};

/** A signer this browser exposes right now, at exactly this address. */
export type WalletConnectionFact = {
  id: string;
  family: WalletFamily;
  address: string;
  kind: WalletKind;
  provider?: string;
  chainId?: number;
  walletName?: string;
  capability?: "read" | "write";
  manageable?: boolean;
  providerActions?: readonly AomiAccountAction[];
  /** Embedded only: the provider has hydrated a signer for this address. */
  signerReady?: boolean;
  /** The exact signer exists, but another wallet currently owns execution. */
  signerSelectable?: boolean;
};

export type WalletStateInput = {
  account: { id: string; status: "loading" | "ready" | "error" } | null;
  linked: readonly LinkedWalletFact[];
  connections: readonly WalletConnectionFact[];
  mountedProviders: readonly string[];
  providerSettled?: (family: WalletFamily, provider: string) => boolean;
  selection: Partial<Record<WalletFamily, string>>;
};

/** What the user may do to a row. Presentation picks its own labels. */
export type WalletAction =
  | { kind: "select"; walletKey: string }
  | { kind: "link"; connectionId: string }
  | { kind: "connect"; walletKey: string; provider?: string }
  | { kind: "disconnect"; connectionId: string }
  | { kind: "unlink"; linkedWalletId: string }
  | { kind: "manage" }
  | { kind: "signout" }
  | { kind: "reauthenticate"; provider: string };

type WalletStatus =
  | { state: "ready" }
  | { state: "guest" }
  | { state: "unlinked" }
  | { state: "loading" }
  | { state: "mismatch"; observedAddress: string }
  | {
      state: "offline";
      reason:
        | "disconnected"
        | "provider_unavailable"
        | "signer_unavailable"
        | "selection_required"
        | "account_error";
    };

type WalletFacts = {
  key: string;
  family: WalletFamily;
  address: string;
  kind: WalletKind;
  provider?: string;
  chainId?: number;
  walletName?: string;
  /** The user's own name for the address. */
  label?: string;
  /** The wallet app the address was linked from. */
  walletApp?: string;
  capability?: "read" | "write";
  manageable?: boolean;
  linkedWalletId?: string;
  connectionId?: string;
};

/** What clicking a row that is not ready yet will ask for. */
export type WalletPendingStep = "switch" | "connect";

export type WalletRow = WalletFacts &
  WalletStatus & {
    connected: boolean;
    linked: boolean;
    operating: boolean;
    /** The address chosen for its family on this device, even while it needs a step. */
    active?: boolean;
    /** The wallet app, e.g. "Rabby", or "Privy" for an embedded wallet. */
    brand?: string;
    pendingStep?: WalletPendingStep | null;
    actions: WalletAction[];
  };

export type WalletState = {
  wallets: WalletRow[];
  operating: Partial<Record<WalletFamily, string>>;
  active: Partial<Record<WalletFamily, string>>;
  /** Families whose stored selection is permanently invalid and must go. */
  clearSelection: WalletFamily[];
  /** Operating wallets that may be saved; a stand-in never replaces a save. */
  persist: Partial<Record<WalletFamily, string>>;
};

/**
 * The one place that decides which wallets exist for this account on this
 * host, and which of them the account operates with.
 */
export function resolveWalletState(input: WalletStateInput): WalletState {
  const connected = new Map(
    input.connections.map((c) => [walletKey(c.family, c.address), c]),
  );
  const linked = new Set<string>();
  const claimedConnections = new Set<string>();
  const rows = new Map<string, WalletFacts & WalletStatus>();
  for (const wallet of input.linked) {
    const key = walletKey(wallet.family, wallet.address);
    linked.add(key);
    const connection = connected.get(key);
    const row: WalletFacts = {
      key,
      family: wallet.family,
      address: wallet.address,
      kind: wallet.kind ?? connection?.kind ?? "external",
      ...((wallet.provider ?? connection?.provider)
        ? { provider: wallet.provider ?? connection?.provider }
        : {}),
      ...((wallet.chainId ?? connection?.chainId)
        ? { chainId: wallet.chainId ?? connection?.chainId }
        : {}),
      ...(wallet.label?.trim() ? { label: wallet.label.trim() } : {}),
      ...(wallet.walletApp ? { walletApp: wallet.walletApp } : {}),
      ...(connection?.walletName ? { walletName: connection.walletName } : {}),
      ...((wallet.capability ?? connection?.capability)
        ? { capability: wallet.capability ?? connection?.capability }
        : {}),
      ...(connection?.manageable ? { manageable: true } : {}),
      linkedWalletId: wallet.id,
      ...(connection ? { connectionId: connection.id } : {}),
    };
    if (connection) claimedConnections.add(key);
    const providerConnection =
      wallet.kind === "embedded" && wallet.provider
        ? input.connections.find(
            (candidate) =>
              candidate.kind === "embedded" &&
              candidate.family === wallet.family &&
              candidate.provider === wallet.provider,
          )
        : undefined;
    if (providerConnection)
      claimedConnections.add(
        walletKey(providerConnection.family, providerConnection.address),
      );
    rows.set(
      key,
      input.account?.status === "loading"
        ? { ...row, state: "loading" }
        : input.account?.status === "error"
          ? { ...row, state: "offline", reason: "account_error" }
          : !connection && wallet.kind === "embedded"
            ? !input.mountedProviders.includes(wallet.provider ?? "")
              ? { ...row, state: "offline", reason: "provider_unavailable" }
              : providerConnection
                ? providerConnection.signerReady
                  ? {
                      ...row,
                      state: "mismatch",
                      observedAddress: providerConnection.address,
                    }
                  : input.providerSettled?.(
                        wallet.family,
                        wallet.provider ?? "",
                      )
                    ? { ...row, state: "offline", reason: "signer_unavailable" }
                    : { ...row, state: "loading" }
                : input.providerSettled?.(wallet.family, wallet.provider ?? "")
                  ? { ...row, state: "offline", reason: "signer_unavailable" }
                  : { ...row, state: "loading" }
            : !connection
              ? { ...row, state: "offline", reason: "disconnected" }
              : connection.kind === "embedded" && !connection.signerReady
                ? connection.signerSelectable
                  ? { ...row, state: "offline", reason: "selection_required" }
                  : input.providerSettled?.(
                        connection.family,
                        connection.provider ?? wallet.provider ?? "",
                      )
                    ? { ...row, state: "offline", reason: "signer_unavailable" }
                    : { ...row, state: "loading" }
                : { ...row, state: "ready" },
    );
  }
  for (const connection of input.connections) {
    const key = walletKey(connection.family, connection.address);
    if (rows.has(key) || claimedConnections.has(key)) continue;
    rows.set(key, {
      key,
      family: connection.family,
      address: connection.address,
      kind: connection.kind,
      ...(connection.provider ? { provider: connection.provider } : {}),
      ...(connection.chainId ? { chainId: connection.chainId } : {}),
      ...(connection.walletName ? { walletName: connection.walletName } : {}),
      ...(connection.capability ? { capability: connection.capability } : {}),
      ...(connection.manageable ? { manageable: true } : {}),
      connectionId: connection.id,
      // A guest owns nothing, so a connected external wallet operates through
      // the client-only path. Until an account's graph lands, "not linked" is
      // not yet knowable. Once it has, an embedded address the account never
      // attested is a fault, not a wallet waiting to be linked.
      ...(!input.account
        ? connection.kind === "embedded"
          ? { state: "loading" as const }
          : { state: "guest" as const }
        : input.account.status === "loading"
          ? { state: "loading" as const }
          : input.account.status === "error"
            ? { state: "offline" as const, reason: "account_error" as const }
            : connection.kind === "embedded"
              ? ({
                  state: "mismatch",
                  observedAddress: connection.address,
                } as const)
              : { state: "unlinked" as const }),
    });
  }

  const operating: WalletState["operating"] = {};
  const active: WalletState["active"] = {};
  const clearSelection: WalletFamily[] = [];
  const persist: WalletState["persist"] = {};
  for (const family of ["evm", "svm"] as const) {
    const eligible = [...rows.values()].filter(
      (row) =>
        row.family === family &&
        (row.state === "ready" || row.state === "guest"),
    );
    let stored = input.selection[family];
    // Not owned by this account means gone for good; merely unreachable means
    // operate the only eligible wallet in its place without saving it, so the
    // saved wallet returns once reachable (an embedded signer may still be
    // hydrating). Ownership is only knowable once the account graph landed.
    const owned =
      stored !== undefined &&
      (!input.account
        ? rows.get(stored)?.state === "guest"
        : input.account.status !== "ready" || linked.has(stored));
    if (stored && !owned) {
      clearSelection.push(family);
      stored = undefined;
    }
    if (stored) {
      if (eligible.some((row) => row.key === stored))
        operating[family] = persist[family] = stored;
      else if (eligible.length === 1) operating[family] = eligible[0].key;
    } else if (eligible.length === 1) {
      operating[family] = persist[family] = eligible[0].key;
    }
    // A saved address its wallet app moved away from stays the active one;
    // it signs again once the app switches back.
    active[family] =
      operating[family] ?? (stored && rows.has(stored) ? stored : undefined);
  }
  const brands = new Map(
    [...rows.values()].map((row) => [row.key, rowBrand(row)]),
  );

  const wallets = [...rows.values()].map((row): WalletRow => {
    const isOperating = operating[row.family] === row.key;
    const actions: WalletAction[] = [];
    if (row.state === "ready" || row.state === "guest") {
      if (!isOperating) actions.push({ kind: "select", walletKey: row.key });
      if (row.state === "guest" && row.connectionId) {
        actions.push({ kind: "link", connectionId: row.connectionId });
      }
      const connection = row.connectionId ? connected.get(row.key) : undefined;
      if (connection?.providerActions?.length) {
        for (const action of connection.providerActions) {
          if (action.kind === "disconnect") {
            actions.push({ kind: "disconnect", connectionId: connection.id });
          } else {
            actions.push({ kind: action.kind });
          }
        }
      } else if (row.connectionId) {
        actions.push({ kind: "disconnect", connectionId: row.connectionId });
      }
      if (row.state === "ready" && row.linkedWalletId)
        actions.push({ kind: "unlink", linkedWalletId: row.linkedWalletId });
    } else if (row.state === "unlinked") {
      if (row.connectionId) {
        actions.push({ kind: "link", connectionId: row.connectionId });
        actions.push({ kind: "disconnect", connectionId: row.connectionId });
      }
    } else if (row.state === "loading") {
      if (row.connectionId)
        actions.push({ kind: "disconnect", connectionId: row.connectionId });
    } else if (row.state === "mismatch") {
      if (row.provider)
        actions.push({ kind: "reauthenticate", provider: row.provider });
    } else if (row.reason === "provider_unavailable") {
      if (row.linkedWalletId)
        actions.push({ kind: "unlink", linkedWalletId: row.linkedWalletId });
    } else if (row.reason === "selection_required") {
      if (row.linkedWalletId && row.connectionId)
        actions.push({ kind: "select", walletKey: row.key });
    } else if (row.reason === "signer_unavailable" && row.provider) {
      actions.push({ kind: "reauthenticate", provider: row.provider });
    } else if (row.reason === "account_error") {
      // A stale account graph is insufficient to authorize wallet selection.
    } else {
      actions.push({
        kind: "connect",
        walletKey: row.key,
        ...(row.provider ? { provider: row.provider } : {}),
      });
      if (row.linkedWalletId)
        actions.push({ kind: "unlink", linkedWalletId: row.linkedWalletId });
    }
    const brand = brands.get(row.key);
    return {
      ...row,
      ...(brand ? { brand } : {}),
      connected: Boolean(row.connectionId),
      linked: Boolean(row.linkedWalletId),
      operating: isOperating,
      active: active[row.family] === row.key,
      pendingStep: pendingStep(row, rows, brands),
      actions,
    };
  });
  return { wallets, operating, active, clearSelection, persist };
}

function rowBrand(row: WalletFacts): string | undefined {
  if (row.kind === "embedded" && row.provider)
    return formatWalletProvider(row.provider);
  if (row.walletName) return brandDisplayName(row.walletName);
  return row.walletApp;
}

function pendingStep(
  row: WalletFacts & WalletStatus,
  rows: ReadonlyMap<string, WalletFacts & WalletStatus>,
  brands: ReadonlyMap<string, string | undefined>,
): WalletPendingStep | null {
  if (row.state !== "offline" && row.state !== "mismatch") return null;
  if (row.state === "offline" && row.reason === "account_error") return null;
  if (row.kind === "embedded") return "connect";
  const brand = brands.get(row.key);
  // The app is here on another address: the user switches inside the app.
  const appIsHere = [...rows.values()].some(
    (other) =>
      other.key !== row.key &&
      other.family === row.family &&
      Boolean(other.connectionId) &&
      Boolean(brand) &&
      brands.get(other.key) === brand,
  );
  return appIsHere ? "switch" : "connect";
}

/** What making a row active takes: nothing, a selection, the app, or a connect. */
export type WalletActivation =
  | { kind: "active" }
  | { kind: "select"; accountId: string }
  | { kind: "switch"; appAccountId?: string }
  | { kind: "connect" };

export function planWalletActivation(
  wallets: readonly WalletRow[],
  key: string,
): WalletActivation | null {
  const row = wallets.find((wallet) => wallet.key === key);
  if (!row) return null;
  if (row.state === "ready" || row.state === "guest") {
    return row.operating || !row.connectionId
      ? { kind: "active" }
      : { kind: "select", accountId: row.connectionId };
  }
  if (row.pendingStep === "switch") {
    const app = wallets.find(
      (wallet) =>
        wallet.family === row.family &&
        wallet.connectionId &&
        wallet.brand === row.brand,
    );
    return {
      kind: "switch",
      ...(app?.connectionId ? { appAccountId: app.connectionId } : {}),
    };
  }
  return { kind: "connect" };
}
