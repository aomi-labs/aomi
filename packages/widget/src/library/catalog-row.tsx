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
import { packageIconUrl } from "@/icons/preview-package-icons";
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

/**
 * A row's first action: its icon, opening to its label only while the row is
 * hovered or its button has keyboard focus. Being selected does not open it.
 */
function ActionLabel({ children }: { children: string }) {
  return (
    <span className="grid grid-cols-[0fr] opacity-0 transition-[grid-template-columns,opacity] duration-[260ms] ease-[cubic-bezier(.22,.8,.26,1)] group-hover:grid-cols-[1fr] group-hover:opacity-100 group-has-[:focus-visible]:grid-cols-[1fr] group-has-[:focus-visible]:opacity-100 motion-reduce:transition-none [@media(hover:none)]:hidden">
      <span className="min-w-0 overflow-hidden">
        <span className="pl-1.5">{children}</span>
      </span>
    </span>
  );
}

const ROW_ACTION =
  "gap-0 px-1.5 group-data-selected:bg-[color-mix(in_srgb,var(--aomi-fg)_8%,var(--aomi-surface-2))] group-data-selected:hover:bg-[color-mix(in_srgb,var(--aomi-fg)_13%,var(--aomi-surface-2))] max-md:h-9 max-md:px-[11px]";

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
          size="sm"
          aria-label={`Use in chat: ${row.display_name}`}
          className={ROW_ACTION}
          onClick={() => onUse(row)}
        >
          <MessageCircle />
          <ActionLabel>Use in chat</ActionLabel>
        </AomiButton>
      );
    case "turn_on":
      return (
        <AomiButton
          size="sm"
          aria-label={`Turn on ${row.display_name}`}
          className={ROW_ACTION}
          onClick={() => onToggle(row, true)}
        >
          <Plus />
          <ActionLabel>Turn on</ActionLabel>
        </AomiButton>
      );
    case "connect":
      return (
        <AomiButton
          variant="ghost"
          size="sm"
          aria-label={`Connect ${row.display_name}`}
          className="bg-aomi-warning/15 hover:bg-aomi-warning/25 hover:text-aomi-fg gap-0 px-1.5 text-[color-mix(in_srgb,var(--aomi-warning)_62%,var(--aomi-fg))] max-md:h-9 max-md:px-[11px]"
          onClick={() => onConnect(row)}
        >
          <KeyRound />
          <ActionLabel>Connect</ActionLabel>
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
        selected ? "bg-aomi-surface-2" : "hover:bg-aomi-surface-2/70",
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
          <PackageTile iconUrl={packageIconUrl(row)} />
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
