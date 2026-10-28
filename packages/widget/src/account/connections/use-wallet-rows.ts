"use client";

import { useMemo } from "react";
import type {
  AomiAccountWallet,
  AomiAgentWallet,
  AomiClient,
  AomiLane,
} from "@aomi-labs/client";
import { useDisplayQuery } from "@aomi-labs/react";
import {
  accountWalletsQuery,
  agentWalletsQuery,
} from "@/account/account-queries";
import { AGENT_WALLET } from "@/account/account-management/wallet-model";
import { titleCase } from "@/account/account-management/controls";
import type { WalletViewRow } from "./wallet-view";

/**
 * The wallet view's rows: live agent wallets (newest use first, as the
 * server orders them), then each sign-in wallet with its EVM and SVM
 * addresses together.
 */
function walletViewRows(
  agents: readonly AomiAgentWallet[],
  entries: readonly AomiAccountWallet[],
): WalletViewRow[] {
  const rows: WalletViewRow[] = agents
    .filter((wallet) => wallet.archived_at === null)
    .map((wallet) => ({
      id: wallet.id,
      name: wallet.name,
      kind: "agent",
      brand: AGENT_WALLET,
      addresses: wallet.addresses,
      app: wallet.app?.label ?? null,
      paused: wallet.paused,
    }));
  const signIn = new Map<string, WalletViewRow>();
  for (const entry of entries) {
    if (entry.kind === "agent") continue;
    const brand =
      entry.browser_app ?? (entry.provider ? titleCase(entry.provider) : null);
    const group = `${entry.kind}:${brand ?? entry.label}`;
    const row = signIn.get(group) ?? {
      id: `wallet:${entry.id}`,
      name: entry.custom_label ?? entry.label,
      kind: "sign-in" as const,
      brand: brand ?? entry.label,
      addresses: [],
    };
    signIn.set(group, {
      ...row,
      addresses: [
        ...row.addresses,
        { family: entry.family, address: entry.address },
      ],
    });
  }
  return [...rows, ...signIn.values()];
}

/** The account's wallets for the wallet view, and the agent wallet list. */
export function useWalletRows(client: AomiClient) {
  const agents = useDisplayQuery(agentWalletsQuery(client));
  const entries = useDisplayQuery(accountWalletsQuery(client));
  const rows = useMemo(
    () =>
      agents.data
        ? walletViewRows(agents.data.wallets, entries.data ?? [])
        : undefined,
    [agents.data, entries.data],
  );
  return {
    rows,
    agents: agents.data?.wallets,
    isPending: agents.isPending,
    failed: Boolean(agents.error),
  };
}

/** Connection `key`'s lane on each agent wallet, as the server judges it. */
export function knownLanes(
  agents: readonly AomiAgentWallet[],
  key: string | undefined,
): Partial<Record<string, AomiLane>> {
  return Object.fromEntries(
    agents.flatMap((wallet) => {
      const lane = wallet.connections.find(
        (connection) => connection.key === key,
      )?.lane;
      return lane ? [[wallet.id, lane]] : [];
    }),
  );
}

/** [`knownLanes`], else `start` (a connection the server doesn't know yet). */
export function lanesOf(
  agents: readonly AomiAgentWallet[],
  key: string | undefined,
  start: AomiLane,
): Record<string, AomiLane> {
  const known = knownLanes(agents, key);
  return Object.fromEntries(
    agents.map((wallet) => [wallet.id, known[wallet.id] ?? start]),
  );
}
