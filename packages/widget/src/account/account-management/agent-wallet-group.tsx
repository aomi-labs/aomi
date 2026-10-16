"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import type { AomiAccountWallet, AomiAgentRule } from "@aomi-labs/client";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import { ActionsMenu, BrandMark, Divider, type MenuItem } from "./controls";
import { AddressRow } from "./wallet-rows";
import { AGENT_WALLET } from "./wallet-model";

export type AgentWalletHandlers = {
  /** Lock or unlock every agent wallet of the account. */
  onLock?: (locked: boolean) => void;
  /** Rename the default agent wallets; resolves false when it did not save. */
  onRename?: (label: string | null) => Promise<boolean>;
};

/**
 * Settings › Wallets & access › Agent wallet: one parent row (the account's
 * lock) with each agent address nested under it, like a Privy login.
 */
export function AgentWalletGroup({
  rows,
  wallets,
  rule,
  pending,
  onActivate,
  onLock,
  onRename,
}: AgentWalletHandlers & {
  /** The wallet kit's agent rows; they carry Active and the pick. */
  rows: readonly WalletRow[];
  /** The account's wallet list; undefined when it failed to load. */
  wallets?: readonly AomiAccountWallet[];
  rule?: AomiAgentRule;
  pending: string | null;
  onActivate?: (row: WalletRow) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const locked = rule?.locked === true;
  const name =
    wallets?.find((wallet) => wallet.is_default && wallet.custom_label)
      ?.custom_label ?? AGENT_WALLET;
  const save = async () => {
    if (draft === null || !onRename) return;
    if (await onRename(draft.trim() || null)) setDraft(null);
  };

  const items: MenuItem[] = [];
  if (rule && onLock)
    items.push(
      locked
        ? { label: "Unlock", onSelect: () => onLock(false) }
        : {
            label: "Lock",
            detail: "Nothing signs until you unlock",
            onSelect: () => onLock(true),
          },
    );
  if (onRename)
    items.push({
      label: "Rename",
      onSelect: () => setDraft(name === AGENT_WALLET ? "" : name),
    });

  return (
    <div data-agent-wallets data-locked={locked || undefined}>
      <Divider
        title="Agent wallet"
        detail="Aomi signs with it when you or a connection asks"
      />
      {wallets && rule ? (
        <>
          <div className="flex min-h-14 items-center gap-3 py-3 pl-3.5 pr-3">
            <BrandMark brand={AGENT_WALLET} dot={locked ? "off" : "on"} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {draft !== null ? (
                <input
                  autoFocus
                  value={draft}
                  maxLength={40}
                  placeholder={AGENT_WALLET}
                  aria-label="Agent wallet name"
                  disabled={pending === "agent:rename"}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void save();
                    if (event.key === "Escape") setDraft(null);
                  }}
                  className="border-aomi-border bg-aomi-bg text-aomi-fg focus:border-aomi-muted type-row rounded-control h-7 w-full max-w-56 border px-2 outline-none transition-colors"
                />
              ) : (
                <span className="type-row flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{name}</span>
                  {locked ? (
                    <Lock
                      aria-label="Locked"
                      className="text-aomi-muted size-3.5 shrink-0"
                    />
                  ) : null}
                </span>
              )}
              <span className="type-meta text-aomi-muted truncate">
                {locked
                  ? "Locked · nothing signs"
                  : rows.length
                    ? "Asks before each trade"
                    : "Setting up its EVM and SVM addresses…"}
              </span>
            </div>
            {items.length ? (
              <ActionsMenu
                label="Actions for agent wallet"
                items={items}
                disabled={pending !== null}
                busy={pending === "agent:lock"}
              />
            ) : null}
          </div>
          {rows.map((row) => (
            <div key={row.key} className="border-aomi-border border-t">
              <AddressRow
                row={row}
                nested
                pending={pending}
                onActivate={onActivate}
              />
            </div>
          ))}
        </>
      ) : (
        <p className="type-control text-aomi-muted px-3.5 py-3">
          Couldn’t load your agent wallet.
        </p>
      )}
    </div>
  );
}
