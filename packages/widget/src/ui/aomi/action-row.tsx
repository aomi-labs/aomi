"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import { cn } from "@aomi-labs/react";

/**
 * One action in a Manage sheet: icon, label, an optional line, and a › when
 * it opens a step (or `trailing`, e.g. a switch). `danger` draws it red; put
 * it alone in the last `ListGroup`.
 */
export function ActionRow({
  icon: Icon,
  label,
  description,
  trailing,
  step = false,
  danger = false,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  description?: ReactNode;
  trailing?: ReactNode;
  /** Opens another step or dialog: shows a ›. */
  step?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "hover:bg-aomi-hover focus-visible:ring-aomi-ring/50 flex min-h-12 w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset disabled:opacity-50",
        danger ? "text-aomi-danger" : "text-aomi-fg",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          danger ? "text-aomi-danger" : "text-aomi-muted",
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13.5px] font-medium leading-5">{label}</span>
        {description ? (
          <span
            className={cn(
              "type-meta truncate",
              danger ? "text-aomi-danger/80" : "text-aomi-muted",
            )}
          >
            {description}
          </span>
        ) : null}
      </span>
      {trailing ??
        (step ? (
          <ChevronRightIcon className="text-aomi-muted size-4 shrink-0" />
        ) : null)}
    </button>
  );
}
