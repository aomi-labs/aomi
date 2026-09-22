"use client";

import type { FC } from "react";
import { cn } from "@aomi-labs/react";
import type { ToolChip } from "./tool-interpreter/types";

/** Base + per-chip stagger for the left-to-right chip cascade (ms). */
const CHIP_BASE_DELAY_MS = 15;
const CHIP_STEP_DELAY_MS = 25;

export const chipAnimationDelay = (index: number): string =>
  `${CHIP_BASE_DELAY_MS + index * CHIP_STEP_DELAY_MS}ms`;

export const ToolChipView: FC<{
  chip: ToolChip;
  index?: number;
  animate?: boolean;
}> = ({ chip, index = 0, animate = false }) => {
  const Glyph = chip.icon;
  return (
    <span
      title={chip.title}
      className={cn(
        "border-aomi-border/80 bg-aomi-raised text-aomi-muted inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] tabular-nums leading-none",
        animate &&
          "animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-[180ms] motion-reduce:animate-none",
      )}
      style={
        animate
          ? {
              animationDelay: chipAnimationDelay(index),
            }
          : undefined
      }
    >
      {chip.dot ? (
        <span
          className="size-[5px] shrink-0 rounded-full"
          style={{ backgroundColor: chip.dot }}
          aria-hidden="true"
        />
      ) : (
        !Glyph && (
          <span
            className="bg-aomi-accent size-[5px] shrink-0 rounded-full"
            aria-hidden="true"
          />
        )
      )}
      {Glyph && <Glyph className="text-aomi-fg/80 size-3.5 shrink-0" />}
      {chip.labelParts ? (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="truncate">{chip.labelParts[0]}</span>
          <svg
            viewBox="0 0 8 16"
            fill="none"
            aria-hidden="true"
            className="text-aomi-muted/40 h-3.5 w-1.5 shrink-0"
          >
            <path
              d="M6 2 2 14"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
            />
          </svg>
          <span className="sr-only"> / </span>
          <span className="truncate">{chip.labelParts[1]}</span>
        </span>
      ) : (
        <span className="truncate">{chip.label}</span>
      )}
    </span>
  );
};
