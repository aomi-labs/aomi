"use client";

import { useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Lock,
  Pause,
  Pencil,
  Play,
  SlidersHorizontal,
} from "lucide-react";
import type { AomiAgentWallet } from "@aomi-labs/client";
import { cn } from "@aomi-labs/react";
import { useRenameDialog } from "@/ui/aomi/rename-dialog";
import { StatusPill } from "@/ui/aomi/status-pill";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import {
  ActionsMenu,
  BrandMark,
  ExpandToggle,
  type MenuItem,
} from "@/account/account-management/controls";
import { AddressRow } from "@/account/account-management/wallet-rows";
import { AGENT_WALLET } from "@/account/account-management/wallet-model";
import { walletSummary } from "./agent-wallet-model";

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
  const active = rows.some((row) => row.active);
  // Open while it holds the active address, until you toggle it yourself.
  const [toggled, setOpen] = useState<boolean | null>(null);
  const open = toggled ?? active;
  const { renameWallet, dialog } = useRenameWallet(actions.onRename);
  const archived = wallet.archived_at !== null;
  const paused = wallet.paused || pausedAll;
  const busy = pending === `agent:${wallet.id}`;
  const items = agentWalletItems(wallet, actions, () => renameWallet(wallet));
  const title = (
    <span className="type-row flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="truncate">{wallet.name}</span>
      {wallet.app ? (
        <StatusPill tone="warning">used by {wallet.app.label}</StatusPill>
      ) : null}
      {wallet.paused ? (
        <StatusPill tone="danger">
          <Lock className="size-3" />
          Paused
        </StatusPill>
      ) : null}
    </span>
  );

  const only = rows.length === 1 ? rows[0] : undefined;
  if (only)
    return (
      <div
        data-agent-wallet={wallet.id}
        data-paused={paused || undefined}
        className="border-aomi-border border-t first:border-t-0"
      >
        <AddressRow
          row={only}
          title={title}
          pending={pending}
          onActivate={archived ? undefined : onActivate}
          menu={(own) => {
            const [manage, ...rest] = items;
            return [manage, ...own, ...rest];
          }}
        />
        {dialog}
      </div>
    );

  const toggle = rows.length > 0;
  return (
    <div
      data-agent-wallet={wallet.id}
      data-paused={paused || undefined}
      className="border-aomi-border border-t first:border-t-0"
    >
      <div
        className={cn(
          "flex min-h-14 items-center gap-3 pl-2 pr-3 transition-colors",
          toggle && "hover:bg-aomi-hover",
        )}
      >
        {toggle ? (
          <ExpandToggle
            open={open}
            label={`${wallet.name} addresses`}
            onToggle={() => setOpen(!open)}
          />
        ) : (
          <span aria-hidden className="size-[18px] shrink-0" />
        )}
        <button
          type="button"
          tabIndex={-1}
          disabled={!toggle}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 text-left outline-none disabled:cursor-default"
        >
          <BrandMark brand={AGENT_WALLET} dot={paused ? "off" : "on"} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            {title}
            <span className="type-meta text-aomi-muted truncate">
              {walletSummary(wallet)}
            </span>
          </span>
        </button>
        <ActionsMenu
          label={`Actions for ${wallet.name}`}
          items={items}
          disabled={pending !== null}
          busy={busy}
        />
      </div>
      {open
        ? rows.map((row) => (
            <div key={row.key} className="border-aomi-border border-t">
              <AddressRow
                row={row}
                nested
                pending={pending}
                onActivate={archived ? undefined : onActivate}
              />
            </div>
          ))
        : null}
      {dialog}
    </div>
  );
}
