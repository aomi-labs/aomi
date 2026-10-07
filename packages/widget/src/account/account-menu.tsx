"use client";

import { useEffect, useState } from "react";
import { AccountStatusLine } from "./account-status-line";
import { LoadingLine } from "@/ui/aomi/loading-pane";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LoaderCircleIcon,
  LogOutIcon,
  PlusIcon,
  UnplugIcon,
  WalletCardsIcon,
} from "lucide-react";
import { shortAddress } from "@aomi-labs/client";
import { cn } from "@aomi-labs/react";
import { aomiButton } from "@/ui/aomi/button";
import { AccountAvatar } from "./account-avatar";
import type { WalletFamily } from "@/wallet/types";
import { BrandMark } from "./account-management/controls";
import { FamilyTag } from "./account-management/signs-with";
import {
  appName,
  familySlots,
  rowTitle,
} from "./account-management/wallet-model";
import type { WalletRow } from "@/wallet/composer/wallet-state";

type ActivateResult = "active" | "switching" | "connecting";

export type AccountMenuProps = {
  open: boolean;
  accountLabel?: string;
  accountId?: string;
  address?: string;
  walletLabel?: string;
  allowanceLine?: string;
  planLabel?: string;
  allowanceLoading?: boolean;
  noticeLine?: string;
  themeLabel?: string;
  rows?: readonly WalletRow[];
  /** A connected address that is not in the account yet. */
  unlinked?: WalletRow;
  onClose: () => void;
  onManageAccount?: () => void;
  onToggleTheme?: () => void;
  onOpenSettings?: () => void;
  onSignIn?: () => void;
  onActivateWallet?: (key: string) => Promise<ActivateResult>;
  onAddWallet?: () => void;
  onVerify?: () => void;
  onSignOut: () => void;
  onDisconnect: () => void;
};

function MenuRow({
  label,
  trailing,
  onClick,
}: {
  label: string;
  trailing?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-aomi-fg hover:bg-aomi-surface-2 flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-left text-[13px] transition-colors"
    >
      <span>{label}</span>
      {trailing ? (
        <span className="text-aomi-muted text-[12px]">{trailing}</span>
      ) : null}
    </button>
  );
}

export function AccountMenu({
  open,
  accountLabel,
  accountId,
  address,
  walletLabel,
  allowanceLine,
  planLabel,
  allowanceLoading = false,
  noticeLine,
  themeLabel,
  rows = [],
  unlinked,
  onClose,
  onManageAccount,
  onToggleTheme,
  onOpenSettings,
  onSignIn,
  onActivateWallet,
  onAddWallet,
  onVerify,
  onSignOut,
  onDisconnect,
}: AccountMenuProps) {
  const [sessionOpen, setSessionOpen] = useState(false);

  useEffect(() => {
    if (!open) setSessionOpen(false);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Dismiss account menu"
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
      />
      <div
        role="menu"
        aria-label="Account menu"
        className="border-aomi-border bg-aomi-raised absolute bottom-[calc(100%+8px)] left-0 z-50 flex max-h-[calc(100dvh-1rem)] w-[min(248px,calc(100vw-1.5rem))] flex-col overflow-y-auto rounded-xl border p-2 shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
      >
        <div className="bg-aomi-surface-2/55 mx-0.5 mb-2 rounded-lg px-2 pb-1.5 pt-3">
          <div className="flex min-w-0 items-center gap-1.5 px-1">
            <AccountAvatar
              seed={accountId}
              size={16}
              className="bg-aomi-surface-2 shrink-0 rounded-full"
            />
            <span className="truncate text-[13px] font-semibold">
              {accountLabel ?? walletLabel ?? "Account"}
            </span>
          </div>
          {allowanceLine || allowanceLoading ? (
            <div className="text-aomi-muted mt-1.5 px-1 text-[12px] font-medium">
              {allowanceLoading ? (
                <LoadingLine className="w-24" />
              ) : allowanceLine ? (
                <AccountStatusLine
                  creditsLine={allowanceLine}
                  planLabel={planLabel}
                />
              ) : null}
            </div>
          ) : null}
          {noticeLine ? (
            <p className="text-aomi-muted mt-2 px-1 text-[12px] leading-snug">
              {noticeLine}
            </p>
          ) : null}
          <SignsWithRows
            rows={rows}
            unlinked={unlinked}
            onActivateWallet={onActivateWallet}
            onVerify={onVerify}
            onAddWallet={onAddWallet}
            onClose={onClose}
          />
          {onAddWallet ? (
            <button
              type="button"
              onClick={onAddWallet}
              className="text-aomi-muted hover:text-aomi-fg mt-1 flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-[12px] transition-colors"
            >
              <PlusIcon size={13} />
              Add a wallet
            </button>
          ) : null}
        </div>

        {onSignIn ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              onSignIn();
            }}
            className="bg-aomi-fg text-aomi-bg mx-0.5 mb-1 flex h-9 w-[calc(100%-4px)] items-center justify-center rounded-lg px-2.5 text-[13px] font-medium transition-opacity hover:opacity-90"
          >
            Sign in
          </button>
        ) : null}

        {onManageAccount ? (
          <MenuRow
            label="Manage account"
            trailing="›"
            onClick={onManageAccount}
          />
        ) : null}
        {onToggleTheme ? (
          <MenuRow
            label="Theme"
            trailing={`${themeLabel ?? "Auto"} ›`}
            onClick={onToggleTheme}
          />
        ) : null}
        {onOpenSettings ? (
          <MenuRow label="Settings" onClick={onOpenSettings} />
        ) : null}
        <a
          href="https://aomi.dev/docs"
          target="_blank"
          rel="noreferrer"
          className="text-aomi-muted hover:bg-aomi-surface-2 hover:text-aomi-fg flex h-9 items-center rounded-lg px-2.5 text-[13px] transition-colors"
          onClick={onClose}
        >
          Docs
        </a>
        <div className="border-aomi-border/70 mx-0.5 mt-2 border-t pt-2">
          <button
            type="button"
            aria-expanded={sessionOpen}
            onClick={() => setSessionOpen((value) => !value)}
            className="text-aomi-fg hover:bg-aomi-surface-2 flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium transition-colors"
          >
            <WalletCardsIcon className="text-aomi-muted" size={14} />
            <span className="flex-1 text-left">Session &amp; wallet</span>
            <ChevronDownIcon
              className={`text-aomi-muted transition-transform ${sessionOpen ? "rotate-180" : ""}`}
              size={14}
            />
          </button>

          {sessionOpen ? (
            <div className="bg-aomi-bg/45 border-aomi-border/70 mt-1 overflow-hidden rounded-lg border p-1">
              {address ? (
                <button
                  type="button"
                  onClick={onDisconnect}
                  className="hover:bg-aomi-surface-2 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors"
                >
                  <UnplugIcon className="text-aomi-muted shrink-0" size={14} />
                  <span className="min-w-0 flex-1">
                    <span className="text-aomi-fg block text-[12px] font-medium">
                      Disconnect {walletLabel ?? "wallet"}
                    </span>
                    <span className="text-aomi-muted block text-[11px] leading-snug">
                      Keep the Aomi account signed in
                    </span>
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={onSignOut}
                className="hover:bg-aomi-danger/5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors"
              >
                <LogOutIcon className="text-aomi-danger shrink-0" size={14} />
                <span className="min-w-0 flex-1">
                  <span className="text-aomi-danger block text-[12px] font-medium">
                    Sign out
                  </span>
                  <span className="text-aomi-muted block text-[11px] leading-snug">
                    End the session and disconnect this device
                  </span>
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

/**
 * One row per family the account has: the address that signs right now. A
 * row expands in place into that family's addresses; a usable one switches
 * at once and the menu stays open, others open their step.
 */
function SignsWithRows({
  rows,
  unlinked,
  onActivateWallet,
  onVerify,
  onAddWallet,
  onClose,
}: {
  rows: readonly WalletRow[];
  unlinked?: WalletRow;
  onActivateWallet?: (key: string) => Promise<ActivateResult>;
  onVerify?: () => void;
  onAddWallet?: () => void;
  onClose: () => void;
}) {
  const [openFamily, setOpenFamily] = useState<WalletFamily | null>(null);
  const [switching, setSwitching] = useState<string>();
  const slots = familySlots(rows);
  if (!rows.length && !unlinked && !onAddWallet) return null;

  const activate = async (row: WalletRow) => {
    if (row.active || !onActivateWallet || switching) return;
    setSwitching(row.key);
    try {
      const result = await onActivateWallet(row.key);
      if (result !== "active") onClose();
    } catch (error) {
      console.warn("[AccountMenu] wallet switch failed", error);
    } finally {
      setSwitching(undefined);
    }
  };

  return (
    <div className="border-aomi-border/70 bg-aomi-raised mt-2.5 overflow-hidden rounded-lg border">
      {unlinked ? (
        <div className="bg-aomi-warning/15 flex items-center gap-2 px-2 py-1.5">
          <BrandMark brand={appName(unlinked)} dot="off" size={15} box={26} />
          <span className="min-w-0 flex-1">
            <span className="text-aomi-fg block truncate text-[12px] font-medium">
              New address in {appName(unlinked)}
            </span>
            <span className="text-aomi-muted block truncate font-mono text-[11px]">
              {shortAddress(unlinked.address)}
            </span>
          </span>
          {onVerify ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onVerify();
              }}
              className={aomiButton({ variant: "primary", size: "sm" })}
            >
              Verify
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="divide-aomi-border/70 divide-y">
        {slots.map((slot) => {
          const expanded = openFamily === slot.family;
          const current = slot.current;
          if (!current)
            return (
              <EmptyFamilyRow
                key={slot.family}
                family={slot.family}
                onAddWallet={onAddWallet}
              />
            );
          return expanded ? (
            <div
              key={slot.family}
              role="group"
              aria-label={`${slot.family.toUpperCase()} wallets`}
            >
              <button
                type="button"
                aria-expanded
                onClick={() => setOpenFamily(null)}
                className="hover:bg-aomi-hover/60 flex w-full items-center justify-between px-2.5 py-2 text-left text-[12px] font-medium transition-colors"
              >
                {slot.family === "evm" ? "EVM" : "SVM"} wallets
                <ChevronUpIcon className="text-aomi-muted" size={14} />
              </button>
              {slot.rows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={row.active}
                  aria-label={`Use ${rowTitle(row).title} ${shortAddress(row.address)}`}
                  disabled={Boolean(switching)}
                  onClick={() => void activate(row)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors",
                    row.active
                      ? "bg-aomi-surface-2/70"
                      : "hover:bg-aomi-hover/60",
                  )}
                >
                  <WalletLine row={row} />
                  {switching === row.key ? (
                    <LoaderCircleIcon
                      className="text-aomi-muted animate-spin"
                      size={13}
                    />
                  ) : row.active ? (
                    <CheckIcon className="text-aomi-fg" size={14} />
                  ) : null}
                </button>
              ))}
              {onAddWallet ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={onAddWallet}
                  className="text-aomi-muted hover:bg-aomi-hover/60 hover:text-aomi-fg flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] transition-colors"
                >
                  <span className="flex size-[26px] shrink-0 items-center justify-center">
                    <PlusIcon size={14} />
                  </span>
                  Add a wallet
                </button>
              ) : null}
            </div>
          ) : (
            <button
              key={slot.family}
              type="button"
              aria-expanded={false}
              aria-label={`${slot.family.toUpperCase()} signs with ${rowTitle(current).title}`}
              onClick={() => setOpenFamily(slot.family)}
              className="hover:bg-aomi-hover/60 flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors"
            >
              <WalletLine row={current} />
              <FamilyTag family={slot.family} />
              <ChevronDownIcon className="text-aomi-muted" size={14} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A family with no address: one row that adds one. */
function EmptyFamilyRow({
  family,
  onAddWallet,
}: {
  family: WalletFamily;
  onAddWallet?: () => void;
}) {
  const label = `${family.toUpperCase()} wallet`;
  if (!onAddWallet)
    return (
      <div className="text-aomi-muted flex w-full items-center px-2 py-2 pl-3 text-left text-[12px]">
        No {label}
      </div>
    );
  return (
    <button
      type="button"
      onClick={onAddWallet}
      className="text-aomi-muted hover:bg-aomi-hover/60 hover:text-aomi-fg flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] transition-colors"
    >
      <span className="flex size-[26px] shrink-0 items-center justify-center">
        <PlusIcon size={14} />
      </span>
      Add {label}
    </button>
  );
}

function WalletLine({ row }: { row: WalletRow }) {
  return (
    <span
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2",
        !row.active && !row.connected && "opacity-60",
      )}
    >
      <BrandMark
        brand={appName(row)}
        dot={row.connected ? "on" : "off"}
        size={15}
        box={26}
      />
      <span className="min-w-0 flex-1">
        <span className="text-aomi-fg block truncate text-[12px] font-medium">
          {rowTitle(row).title}
        </span>
        <span className="text-aomi-muted block truncate font-mono text-[11px]">
          {shortAddress(row.address)}
        </span>
      </span>
    </span>
  );
}
