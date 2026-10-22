"use client";

import type { ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Pause,
  Pencil,
  Play,
  SlidersHorizontal,
} from "lucide-react";
import type { AomiAgentWallet } from "@aomi-labs/client";
import { useRenameDialog } from "@/ui/aomi/rename-dialog";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import {
  ActionsMenu,
  BrandMark,
  type MenuItem,
} from "@/account/account-management/controls";
import { ExpandableRow } from "@/account/account-management/expandable-row";
import { AddressRow } from "@/account/account-management/wallet-rows";
import { AGENT_WALLET } from "@/account/account-management/wallet-model";
import {
  AddressSummary,
  PausedMeta,
} from "@/account/account-management/labels";

/** What a wallet's ⋯ menu and Manage sheet can do; a missing handler hides its item. */
export type AgentWalletActions = {
  onManage: (wallet: AomiAgentWallet) => void;
  onRename: (wallet: AomiAgentWallet, name: string) => Promise<boolean>;
  onPause: (wallet: AomiAgentWallet, paused: boolean) => void;
  onArchive: (wallet: AomiAgentWallet, archived: boolean) => void;
};

/** The ⋯ items every agent wallet row shares: Manage, Rename, Pause, Archive. */
export function agentWalletItems(
  wallet: AomiAgentWallet,
  actions: AgentWalletActions,
  rename: () => void,
): MenuItem[] {
  const archived = wallet.archived_at !== null;
  const items: MenuItem[] = [
    {
      label: "Manage",
      icon: SlidersHorizontal,
      onSelect: () => actions.onManage(wallet),
    },
  ];
  if (!archived)
    items.push(
      { label: "Rename", icon: Pencil, onSelect: rename },
      wallet.paused
        ? {
            label: "Resume",
            icon: Play,
            onSelect: () => actions.onPause(wallet, false),
          }
        : {
            label: "Pause",
            icon: Pause,
            onSelect: () => actions.onPause(wallet, true),
          },
    );
  items.push(
    archived
      ? {
          label: "Restore",
          icon: ArchiveRestore,
          onSelect: () => actions.onArchive(wallet, false),
        }
      : {
          label: "Archive",
          icon: Archive,
          danger: true,
          onSelect: () => actions.onArchive(wallet, true),
        },
  );
  return items;
}

/** Opens the Rename dialog for an agent wallet. */
export function useRenameWallet(onRename: AgentWalletActions["onRename"]): {
  renameWallet: (wallet: AomiAgentWallet) => void;
  dialog: ReactNode;
} {
  const { rename, dialog } = useRenameDialog();
  return {
    renameWallet: (wallet) =>
      rename({
        title: "Rename agent wallet",
        description:
          "Only you see this name. Apps and chats show it when they ask to use the wallet.",
        value: wallet.name,
        onSave: (name) => onRename(wallet, name),
      }),
    dialog,
  };
}

/**
 * One agent wallet. With two addresses it is a parent row (name, "used by",
 * Paused, ⋯) that expands to its EVM and SVM rows, open while one is Active;
 * with one address (an app chose one family) it is that address row.
 */
export function AgentWalletRow({
  wallet,
  rows,
  pausedAll,
  pending,
  onActivate,
  ...actions
}: AgentWalletActions & {
  wallet: AomiAgentWallet;
  /** The kit's rows for its addresses; they carry Active and the pick. */
  rows: readonly WalletRow[];
  pausedAll: boolean;
  pending: string | null;
  onActivate?: (row: WalletRow) => void;
}) {
  const { renameWallet, dialog } = useRenameWallet(actions.onRename);
  const archived = wallet.archived_at !== null;
  const paused = wallet.paused || pausedAll;
  const busy = pending === `agent:${wallet.id}`;
  const items = agentWalletItems(wallet, actions, () => renameWallet(wallet));
  const state = paused ? <PausedMeta /> : null;

  const only = rows.length === 1 ? rows[0] : undefined;
  return (
    <div
      data-agent-wallet={wallet.id}
      data-paused={paused || undefined}
      className="border-aomi-border border-t [[data-band]+&]:border-t-0"
    >
      {only ? (
        <AddressRow
          row={only}
          title={<span className="type-row truncate">{wallet.name}</span>}
          trailing={state}
          dim={paused}
          pending={pending}
          onActivate={archived ? undefined : onActivate}
          menu={(own) => {
            const [manage, ...rest] = items;
            return [manage, ...own, ...rest];
          }}
        />
      ) : (
        <ExpandableRow
          label={`${wallet.name} addresses`}
          defaultOpen={rows.some((row) => row.active)}
          leading={
            <BrandMark
              brand={AGENT_WALLET}
              dot={paused ? "off" : "on"}
              dim={paused}
            />
          }
          title={wallet.name}
          description={
            <AddressSummary
              families={wallet.addresses.map((entry) => entry.family)}
            />
          }
          trailing={
            <>
              {state}
              <ActionsMenu
                label={`Actions for ${wallet.name}`}
                items={items}
                disabled={pending !== null}
                busy={busy}
              />
            </>
          }
        >
          {rows.map((row) => (
            <AddressRow
              key={row.key}
              row={row}
              nested
              pending={pending}
              onActivate={archived ? undefined : onActivate}
            />
          ))}
        </ExpandableRow>
      )}
      {dialog}
    </div>
  );
}
