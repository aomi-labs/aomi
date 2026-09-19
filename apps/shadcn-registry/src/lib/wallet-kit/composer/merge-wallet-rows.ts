"use client";

import type { AomiAccount, AomiWalletOption } from "../types";
import type { AccountWallet } from "../account/types";
import type { AuthRuntime } from "./types";
import {
  canLinkWalletBySignature,
  toRegistryFamily,
  walletKey,
} from "../wallet-utils";

export type WalletRowAction =
  | { kind: "select"; label: string }
  | { kind: "connect"; label: string }
  | { kind: "authenticate"; label: string }
  | { kind: "disconnect"; label: string }
  | { kind: "signout"; label: string }
  | { kind: "manage"; label: string }
  | { kind: "link"; label: string }
  | { kind: "unlink"; label: string };

export type WalletModalRow = {
  id: string;
  family: AomiAccount["family"];
  address?: string;
  chainId?: number;
  label: string;
  walletName?: string;
  iconUrl?: string;
  kind?: AomiWalletOption["kind"] | "social";
  source: "live" | "embedded" | "stored" | "option";
  status: "active" | "connected" | "stored" | "available" | "unavailable";
  provider?: string;
  walletKind?: AccountWallet["kind"];
  linked?: boolean;
  linkedVia?: AomiAccount["linkedVia"];
  capability?: "read" | "write";
  manageable?: boolean;
  actions: WalletRowAction[];
};

export function mergeWalletRows({
  accounts,
  storedWallets = [],
  canLinkWallet = false,
  auth,
  options = [],
}: {
  accounts: readonly AomiAccount[];
  storedWallets?: readonly AccountWallet[];
  canLinkWallet?: boolean;
  auth?: Pick<AuthRuntime, "provider" | "status">;
  options?: readonly AomiWalletOption[];
}): WalletModalRow[] {
  const rows: WalletModalRow[] = accounts.map((account) => {
    const stored = storedWallets.find(
      (wallet) =>
        wallet.family === account.family &&
        walletKey(wallet.family, wallet.address) ===
          walletKey(account.family, account.address),
    );
    const linked = account.linked ?? Boolean(stored);
    const actions: WalletRowAction[] = account.actions?.length
      ? account.actions.map((action) => ({
          kind: action.kind,
          label:
            action.label ??
            (action.kind === "manage"
              ? "Manage"
              : action.kind === "signout"
                ? "Sign out"
                : "Disconnect"),
        }))
      : defaultLiveWalletActions({ account, linked, canLinkWallet });
    return {
      id: account.id,
      family: account.family,
      address: account.address,
      chainId: account.chainId,
      label: account.label ?? account.walletName ?? account.address,
      walletName: account.walletName,
      source: "live" as const,
      status: account.active ? ("active" as const) : ("connected" as const),
      provider: account.provider ?? stored?.provider,
      walletKind: account.walletKind ?? stored?.kind,
      linked,
      linkedVia: account.linkedVia ?? stored?.linkedVia,
      capability: account.capability ?? stored?.capability,
      manageable: account.manageable,
      actions,
    };
  });

  const liveKeys = new Set(
    accounts.map((account) => walletKey(account.family, account.address)),
  );
  for (const wallet of storedWallets) {
    if (liveKeys.has(walletKey(wallet.family, wallet.address))) continue;
    const embeddedSignedOut =
      wallet.kind === "embedded" &&
      wallet.provider === auth?.provider &&
      auth?.status !== "authenticated";
    rows.push({
      id: wallet.id,
      family: wallet.family,
      address: wallet.address,
      label: wallet.label ?? wallet.address,
      source: "stored",
      status: "stored",
      provider: wallet.provider,
      walletKind: wallet.kind,
      linked: true,
      capability: wallet.capability,
      actions: [
        embeddedSignedOut
          ? { kind: "authenticate", label: "Sign in" }
          : { kind: "connect", label: "Connect" },
      ],
    });
  }

  for (const option of options) {
    rows.push({
      id: option.id,
      family:
        option.family === "multichain"
          ? "evm"
          : toRegistryFamily(option.family),
      label: option.label,
      walletName: option.label,
      iconUrl: option.iconUrl,
      kind: option.kind,
      source: "option",
      status: option.status === "unavailable" ? "unavailable" : "available",
      provider: option.connectorId,
      actions: [
        {
          kind: option.kind === "social" ? "authenticate" : "connect",
          label: option.kind === "social" ? "Sign in" : "Connect",
        },
      ],
    });
  }

  return rows;
}

function defaultLiveWalletActions({
  account,
  linked,
  canLinkWallet,
}: {
  account: AomiAccount;
  linked: boolean;
  canLinkWallet: boolean;
}): WalletRowAction[] {
  const actions: WalletRowAction[] = [];
  if (
    canLinkWallet &&
    !linked &&
    canLinkWalletBySignature(account.family, account.walletKind)
  ) {
    actions.push({ kind: "link", label: "Link" });
  }
  actions.push(
    account.manageable
      ? { kind: "manage", label: "Manage" }
      : { kind: "disconnect", label: "Disconnect" },
  );
  return actions;
}
