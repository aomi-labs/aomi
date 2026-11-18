"use client";
import type { AomiPackage, AomiPublicPackage } from "@aomi-labs/client";
import { BadgeCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { aomiButton } from "@/ui/aomi/button";
import { StatusPill } from "@/ui/aomi/status-pill";
import { Switch } from "@/ui/aomi/switch";
import { PackageTile } from "@/icons/package-mark";
import {
  FAMILIES,
  contentsLine,
  isAccountRow,
  needsConnect,
  publisher,
} from "./model";

/** The row control: Connect until a required person key is in, then the switch. */
export function PackageControl({
  row,
  busy,
  disabled,
  onToggle,
  onConnect,
}: {
  row: AomiPackage;
  busy: boolean;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  onConnect: () => void;
}) {
  if (busy)
    return (
      <span className="flex w-[72px] justify-end">
        <Loader2 className="text-aomi-muted size-4 animate-spin" />
      </span>
    );
  if (needsConnect(row))
    return (
      <button
        type="button"
        onClick={onConnect}
        disabled={disabled}
        aria-label={`Connect ${row.display_name}`}
        className={cn(
          aomiButton({ variant: "secondary", size: "sm" }),
          "w-[72px]",
        )}
      >
        Connect
      </button>
    );
  return (
    <span className="flex w-[72px] justify-end">
      <Switch
        checked={row.enabled}
        disabled={disabled || row.agent_listed}
        onCheckedChange={onToggle}
        aria-label={`${row.display_name} on in your chats`}
        title={
          row.agent_listed ? "Your agent uses it, so it stays on" : undefined
        }
      />
    </span>
  );
}

/** "by publisher", with the verified mark for a package Aomi verified. */
export function Publisher({ row }: { row: AomiPublicPackage }) {
  return (
    <span className="type-meta text-aomi-muted inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
      by {publisher(row)}
      {row.verified ? (
        <BadgeCheck
          aria-label="Verified"
          className="text-aomi-accent size-[13px]"
        />
      ) : null}
    </span>
  );
}

export function CatalogRow({
  row,
  selected,
  wide,
  busy,
  disabled,
  onSelect,
  onToggle,
  onConnect,
}: {
  /** A guest's public row has no control. */
  row: AomiPublicPackage;
  selected: boolean;
  /** No inspector beside the list: the ecosystem and contents cells show. */
  wide: boolean;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
  onToggle: (row: AomiPackage, enabled: boolean) => void;
  onConnect: (row: AomiPackage) => void;
}) {
  const families = FAMILIES.filter((family) => row.families.includes(family.id))
    .map((family) => family.label)
    .join(" · ");
  return (
    <article
      className={cn(
        "rounded-control flex min-h-14 items-center gap-3 px-2 transition-colors",
        selected ? "bg-aomi-surface-2" : "hover:bg-aomi-hover",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Open ${row.display_name} details`}
        className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
      >
        <PackageTile iconUrl={row.icon_url} />
        <span className="block min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="type-row truncate">{row.display_name}</span>
            <Publisher row={row} />
            {isAccountRow(row) && !row.listed ? (
              <StatusPill tone="accent">Private</StatusPill>
            ) : null}
          </span>
          <span className="type-meta text-aomi-muted mt-0.5 block truncate">
            {row.description}
          </span>
        </span>
      </button>
      {wide ? (
        <>
          <span className="type-meta text-aomi-muted hidden w-24 shrink-0 md:block">
            {families || "Any network"}
          </span>
          <span className="type-meta text-aomi-muted hidden w-[120px] shrink-0 whitespace-nowrap tabular-nums md:block">
            {contentsLine(row)}
          </span>
        </>
      ) : null}
      {isAccountRow(row) ? (
        <PackageControl
          row={row}
          busy={busy}
          disabled={disabled}
          onToggle={(enabled) => onToggle(row, enabled)}
          onConnect={() => onConnect(row)}
        />
      ) : null}
    </article>
  );
}
