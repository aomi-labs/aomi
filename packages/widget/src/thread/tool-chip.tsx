"use client";

import { cn } from "@/lib/cn";
import type { FC } from "react";
import type { ToolChip } from "@aomi-labs/client/trace";
import { traceIcon } from "./trace-icons";
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
}> = ({ chip, index = 0, animate = false }) => {
  const { packages } = useTraceAttribution();
  if (!chip.icon) return null;
  // A hosted package shows its own mark, neutral like every other chip glyph.
  const Glyph =
    packages?.find((item) => item.id === chip.packageId)?.Icon ??
    traceIcon(chip.icon);
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
      <Glyph className="text-aomi-fg/80 size-3.5 shrink-0" />
      <span className="truncate">{chip.label}</span>
    </span>
  );
};
