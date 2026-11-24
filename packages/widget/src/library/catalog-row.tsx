"use client";
import type { AomiPackage, AomiPublicPackage } from "@aomi-labs/client";
import {
  BadgeCheck,
  KeyRound,
  Loader2,
  MessageCircle,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { AomiButton } from "@/ui/aomi/button";
import { StatusPill } from "@/ui/aomi/status-pill";
import { PackageTile } from "@/icons/package-mark";
import { isAccountRow, packageAction, publisher } from "./model";

/** "by publisher", with the verified mark for a package Aomi verified. */
export function Publisher({ row }: { row: AomiPublicPackage }) {
  return (
    <span className="type-meta text-aomi-muted inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
      by {publisher(row)}
      {row.verified ? (
        <BadgeCheck
          aria-label="Verified"
          className="text-aomi-accent-strong size-[13px]"
        />
      ) : null}
    </span>
  );
}

/** What a row or the detail footer can do with a package. */
export interface PackageActions {
  onUse: (row: AomiPackage) => void;
  onToggle: (row: AomiPackage, enabled: boolean) => void;
  onConnect: (row: AomiPackage) => void;
}

/** The label shows on hover, on keyboard focus and on the selected row. */
const QUIET_LABEL =
  "hidden group-hover:inline group-has-[:focus-visible]:inline group-data-selected:inline [@media(hover:none)]:hidden!";

function RowAction({
  row,
  busy,
  onUse,
  onToggle,
  onConnect,
}: { row: AomiPackage; busy: boolean } & PackageActions) {
  if (busy)
    return (
      <Loader2
        aria-label="Saving"
        className="text-aomi-muted mx-2 size-4 shrink-0 animate-spin"
      />
    );
  switch (packageAction(row)) {
    case "use":
      return (
        <AomiButton
          variant="ghost"
          size="sm"
          aria-label={`Use in chat: ${row.display_name}`}
          className="bg-aomi-accent-subtle text-aomi-accent-strong hover:bg-aomi-accent-subtle hover:text-aomi-accent-strong hover:border-aomi-accent-outline px-[7px] max-md:h-9 max-md:px-[11px]"
          onClick={() => onUse(row)}
        >
          <MessageCircle />
          <span className={QUIET_LABEL}>Use in chat</span>
        </AomiButton>
      );
    case "turn_on":
      return (
        <AomiButton
          size="sm"
          aria-label={`Turn on ${row.display_name}`}
          className="max-md:h-9"
          onClick={() => onToggle(row, true)}
        >
          <Plus /> Turn on
        </AomiButton>
      );
    case "connect":
      return (
        <AomiButton
          variant="ghost"
          size="sm"
          aria-label={`Connect ${row.display_name}`}
          className="bg-aomi-warning/15 hover:bg-aomi-warning/25 hover:text-aomi-fg text-[color-mix(in_srgb,var(--aomi-warning)_62%,var(--aomi-fg))] max-md:h-9"
          onClick={() => onConnect(row)}
        >
          <KeyRound /> Connect
        </AomiButton>
      );
    case "unavailable":
      return (
        <span className="type-meta text-aomi-muted shrink-0 max-md:hidden">
          Not in this agent
        </span>
      );
  }
}

/** One package in the list: its details, and beside them its first action. */
export function CatalogRow({
  row,
  selected,
  busy,
  onSelect,
  ...actions
}: {
  row: AomiPublicPackage;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
} & PackageActions) {
  const account = isAccountRow(row) ? row : null;
  return (
    <article
      data-selected={selected || undefined}
      className={cn(
        "rounded-control group flex min-h-14 items-center pr-2.5 transition-colors",
        selected
          ? "bg-aomi-surface-2 ring-aomi-border ring-1 ring-inset"
          : "hover:bg-aomi-surface-2/70",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Open ${row.display_name} details`}
        aria-current={selected || undefined}
        className="rounded-control focus-visible:ring-aomi-ring/50 flex min-w-0 flex-1 items-center gap-3 self-stretch px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <span
          className={cn(
            "flex",
            account && !account.enabled && "opacity-45 grayscale",
          )}
        >
          <PackageTile iconUrl={row.icon_url} />
        </span>
        <span className="block min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="type-row truncate">{row.display_name}</span>
            <Publisher row={row} />
            {account && !account.listed ? (
              <StatusPill tone="accent">Private</StatusPill>
            ) : null}
          </span>
          <span className="type-meta text-aomi-muted mt-0.5 block truncate">
            {row.description}
          </span>
        </span>
      </button>
      {account ? <RowAction row={account} busy={busy} {...actions} /> : null}
    </article>
  );
}
