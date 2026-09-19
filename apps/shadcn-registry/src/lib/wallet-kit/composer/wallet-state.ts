import type { AomiAccountAction, WalletFamily } from "../types";
import { walletKey } from "../wallet-utils";

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
  label?: string;
  capability?: "read" | "write";
  manageable?: boolean;
  providerActions?: readonly AomiAccountAction[];
  /** Embedded only: the provider has hydrated a signer for this address. */
  signerReady?: boolean;
};

export type WalletStateInput = {
  account: { id: string; status: "loading" | "ready" } | null;
  linked: readonly LinkedWalletFact[];
  connections: readonly WalletConnectionFact[];
  mountedProviders: readonly string[];
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
  | { state: "offline"; reason: "disconnected" | "provider_unavailable" };

type WalletFacts = {
  key: string;
  family: WalletFamily;
  address: string;
  kind: WalletKind;
  provider?: string;
  chainId?: number;
  walletName?: string;
  label?: string;
  capability?: "read" | "write";
  manageable?: boolean;
  linkedWalletId?: string;
  connectionId?: string;
};

export type WalletRow = WalletFacts &
  WalletStatus & {
    connected: boolean;
    linked: boolean;
    operating: boolean;
    actions: WalletAction[];
  };

export type WalletState = {
  wallets: WalletRow[];
  operating: Partial<Record<WalletFamily, string>>;
  /** Families whose stored selection is permanently invalid and must go. */
  clearSelection: WalletFamily[];
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
      ...((wallet.label ?? connection?.label)
        ? { label: wallet.label ?? connection?.label }
        : {}),
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
                : { ...row, state: "loading" }
              : { ...row, state: "loading" }
          : !connection
            ? { ...row, state: "offline", reason: "disconnected" }
            : connection.kind === "embedded" && !connection.signerReady
              ? { ...row, state: "loading" }
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
      ...(connection.label ? { label: connection.label } : {}),
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
          : connection.kind === "embedded"
            ? ({
                state: "mismatch",
                observedAddress: connection.address,
              } as const)
            : { state: "unlinked" as const }),
    });
  }

  const operating: WalletState["operating"] = {};
  const clearSelection: WalletFamily[] = [];
  for (const family of ["evm", "svm"] as const) {
    const eligible = [...rows.values()].filter(
      (row) =>
        row.family === family &&
        (row.state === "ready" || row.state === "guest"),
    );
    let stored = input.selection[family];
    // Not owned by this account means gone for good; merely unreachable means
    // wait for it. Ownership is only knowable once the account graph landed.
    const owned =
      stored !== undefined &&
      (!input.account
        ? rows.get(stored)?.state === "guest"
        : input.account.status === "loading" || linked.has(stored));
    if (stored && !owned) {
      clearSelection.push(family);
      stored = undefined;
    }
    if (stored) {
      if (eligible.some((row) => row.key === stored))
        operating[family] = stored;
    } else if (eligible.length === 1) {
      operating[family] = eligible[0].key;
    }
  }

  const wallets = [...rows.values()].map((row): WalletRow => {
    const isOperating = operating[row.family] === row.key;
    const actions: WalletAction[] = [];
    if (row.state === "ready" || row.state === "guest") {
      if (!isOperating) actions.push({ kind: "select", walletKey: row.key });
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
    } else {
      actions.push({
        kind: "connect",
        walletKey: row.key,
        ...(row.provider ? { provider: row.provider } : {}),
      });
      if (row.linkedWalletId)
        actions.push({ kind: "unlink", linkedWalletId: row.linkedWalletId });
    }
    return {
      ...row,
      connected: Boolean(row.connectionId),
      linked: Boolean(row.linkedWalletId),
      operating: isOperating,
      actions,
    };
  });
  return { wallets, operating, clearSelection };
}
