import type { ReactNode } from "react";

import { cn } from "@aomi-labs/react";

export type StatusTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger";

const TONE: Record<StatusTone, string> = {
  neutral: "bg-aomi-surface-2 text-aomi-muted",
  accent: "bg-aomi-accent-subtle text-aomi-accent-strong",
  success: "bg-aomi-success/12 text-aomi-success",
  // The raw warning amber is a fill color: as 11px text on its own tint it
  // falls well under AA. Pulling it toward the ink darkens it on light and
  // lifts it on dark, so one rule reads in both themes.
  warning:
    "bg-aomi-warning/15 text-[color-mix(in_srgb,var(--aomi-warning)_62%,var(--aomi-fg))]",
  danger: "bg-aomi-danger/10 text-aomi-danger",
};

/**
 * A state label for settings, account and library rows ("Active",
 * "Needs renewal", "Not saved"). Not for the chat's working trace — tool and
 * trace chips have their own component and must stay visually distinct.
 */
export function StatusPill({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: StatusTone;
  /** Leading 6px dot in the tone's color. */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      data-status-tone={tone}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11px] font-medium leading-none",
        TONE[tone],
        className,
      )}
    >
      {dot ? (
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}

/**
 * Sits where a row's "Active" pill or check goes while that row is on its way
 * there: a thin muted ring, like the buttons' loading state.
 */
export function PendingMark({
  label = "Activating",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "border-aomi-muted/25 border-t-aomi-muted inline-block size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] [animation-duration:900ms]",
        className,
      )}
    />
  );
}
