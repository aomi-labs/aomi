"use client";

import { cn } from "@/lib/cn";
import type { FC } from "react";
import type { ToolChip } from "@aomi-labs/client/trace";
import { traceIcon } from "./trace-icons";
import { shortAmount } from "./trace-labels";
import { useTraceAttribution } from "./trace-attribution";

/** Base + per-chip stagger for the left-to-right chip cascade (ms). */
const CHIP_BASE_DELAY_MS = 15;
const CHIP_STEP_DELAY_MS = 25;

export const chipAnimationDelay = (index: number): string =>
  `${CHIP_BASE_DELAY_MS + index * CHIP_STEP_DELAY_MS}ms`;

export const ToolChipView: FC<{
  chip: ToolChip;
  index?: number;
  animate?: boolean;
  /** Beside a line of text. */
  compact?: boolean;
}> = ({ chip, index = 0, animate = false, compact = false }) => {
  const { packages } = useTraceAttribution();
  if (!chip.icon) return null;
  const text = shortAmount(chip.label);
  // A hosted package shows its own mark, neutral like every other chip glyph.
  const Glyph =
    packages?.find((item) => item.id === chip.packageId)?.Icon ??
    traceIcon(chip.icon);
  return (
    <span
      title={chip.title ?? (text === chip.label ? undefined : chip.label)}
      className={cn(
        "bg-aomi-surface-2 text-aomi-muted inline-flex min-w-0 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full text-[11px] tabular-nums leading-none",
        compact ? "h-[22px] px-2" : "h-[26px] px-2.5",
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
      <Glyph
        className={cn(
          "text-aomi-fg/85 shrink-0",
          compact ? "size-3" : "size-3.5",
        )}
      />
      <span className="truncate leading-4">{text}</span>
    </span>
  );
};
