"use client";

import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import type { AomiAgentWallet } from "@aomi-labs/client";
import { cn } from "@aomi-labs/react";
import { StatusPill } from "@/ui/aomi/status-pill";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import {
  ActionsMenu,
  BrandMark,
  type MenuItem,
} from "@/account/account-management/controls";
import { AddressRow } from "@/account/account-management/wallet-rows";
import { AGENT_WALLET } from "@/account/account-management/wallet-model";
import { walletSummary } from "./agent-wallet-model";

/** What a parent row's ⋯ menu can do; a missing handler hides its item. */
export type AgentWalletActions = {
  onDetails: (wallet: AomiAgentWallet) => void;
  onUse?: (rows: WalletRow[]) => void;
  onWithdraw: (wallet: AomiAgentWallet) => void;
  onRename: (wallet: AomiAgentWallet, name: string) => Promise<boolean>;
  onPause: (wallet: AomiAgentWallet, paused: boolean) => void;
  onArchive: (wallet: AomiAgentWallet, archived: boolean) => void;
};

/**
 * One agent wallet: a parent row (name, "used by", Paused, ⋯) over today's
 * EVM/SVM address rows. The active wallet starts open; a tap toggles it.
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
  const [open, setOpen] = useState(active);
  const [draft, setDraft] = useState<string | null>(null);
  const archived = wallet.archived_at !== null;
  const paused = wallet.paused || pausedAll;
  const busy = pending === `agent:${wallet.id}`;
  const save = async () => {
    const name = draft?.trim();
    if (!name || name === wallet.name) return setDraft(null);
    if (await actions.onRename(wallet, name)) setDraft(null);
  };

  const items: MenuItem[] = [
    {
      label: "Details",
      detail: "Addresses, QR, chains",
      onSelect: () => actions.onDetails(wallet),
    },
  ];
  if (!archived && !rows.every((row) => row.active) && actions.onUse)
    items.push({
      label: "Use in chats",
      detail: "Make it the active wallet",
      onSelect: () => actions.onUse?.(rows.filter((row) => !row.active)),
    });
  items.push({
    label: "Withdraw…",
    detail: "Move funds to your wallet",
    onSelect: () => actions.onWithdraw(wallet),
  });
  if (!archived)
    items.push(
      { label: "Rename", onSelect: () => setDraft(wallet.name) },
      wallet.paused
        ? { label: "Resume", onSelect: () => actions.onPause(wallet, false) }
        : {
            label: "Pause",
            detail: "Nothing signs until you resume",
            onSelect: () => actions.onPause(wallet, true),
          },
    );
  items.push(
    "divider",
    archived
      ? { label: "Restore", onSelect: () => actions.onArchive(wallet, false) }
      : {
          label: "Archive",
          detail: "Hide it; restore any time",
          onSelect: () => actions.onArchive(wallet, true),
        },
  );

  const title =
    draft !== null ? (
      <input
        autoFocus
        value={draft}
        maxLength={60}
        aria-label={`Name for ${wallet.name}`}
        disabled={busy}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save();
          if (event.key === "Escape") setDraft(null);
        }}
        className="border-aomi-border bg-aomi-bg text-aomi-fg focus:border-aomi-muted type-row rounded-control h-7 w-full max-w-56 border px-2 outline-none transition-colors"
      />
    ) : (
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
  const toggle = rows.length > 0 && draft === null;

  return (
    <div
      data-agent-wallet={wallet.id}
      data-paused={paused || undefined}
      className="border-aomi-border border-t first:border-t-0"
    >
      <div
        className={cn(
          "flex min-h-14 items-center gap-1 pr-3 transition-colors",
          toggle && "hover:bg-aomi-hover",
        )}
      >
        {toggle ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} ${wallet.name} addresses`}
            onClick={() => setOpen((value) => !value)}
            className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pl-3.5 text-left outline-none"
          >
            <ParentBody wallet={wallet} paused={paused} title={title} />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3.5">
            <ParentBody wallet={wallet} paused={paused} title={title} />
          </div>
        )}
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
    </div>
  );
}

function ParentBody({
  wallet,
  paused,
  title,
}: {
  wallet: AomiAgentWallet;
  paused: boolean;
  title: ReactNode;
}) {
  return (
    <>
      <BrandMark brand={AGENT_WALLET} dot={paused ? "off" : "on"} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title}
        <span className="type-meta text-aomi-muted truncate">
          {walletSummary(wallet)}
        </span>
      </span>
    </>
  );
}
