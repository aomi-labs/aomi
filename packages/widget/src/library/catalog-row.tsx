"use client";
import type { AomiPublicPackage } from "@aomi-labs/client";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { StatusPill } from "@/ui/aomi/status-pill";
import { PackageTile } from "@/icons/package-mark";
import { isAccountRow, publisher } from "./model";

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

/** One package in the list; the detail panel beside it holds every control. */
export function CatalogRow({
  row,
  selected,
  onSelect,
}: {
  row: AomiPublicPackage;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <article>
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Open ${row.display_name} details`}
        aria-current={selected || undefined}
        className={cn(
          "rounded-control flex min-h-14 w-full items-center gap-3 px-2.5 py-2 text-left transition-colors",
          selected ? "bg-aomi-surface-2" : "hover:bg-aomi-hover",
        )}
      >
        <PackageTile iconUrl={row.icon_url} />
        <span className="block min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
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
        {isAccountRow(row) ? (
          <span className="type-meta text-aomi-success flex w-9 shrink-0 justify-end font-medium">
            {row.enabled ? "On" : null}
          </span>
        ) : null}
      </button>
    </article>
  );
}
