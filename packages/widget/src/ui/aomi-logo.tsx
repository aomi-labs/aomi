import * as React from "react";

import { cn } from "@aomi-labs/react";

import { AomiMark } from "@/components/aomi-mark";

export type AomiLogoProps = React.ComponentProps<"span"> & {
  markClassName?: string;
  wordmarkClassName?: string;
};

/** Canonical Aomi lockup: orbit mark plus the lowercase serif wordmark. */
export function AomiLogo({
  className,
  markClassName,
  wordmarkClassName,
  ...props
}: AomiLogoProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-[0.34em]", className)}
      {...props}
    >
      <AomiMark className={cn("size-[1em] shrink-0", markClassName)} />
      <span
        className={cn(
          "font-semibold leading-none tracking-[-0.025em]",
          wordmarkClassName,
        )}
        style={{
          fontFamily:
            'var(--aomi-font-wordmark, var(--font-source-serif-4, "Source Serif 4"), ui-serif, Georgia, Cambria, serif)',
        }}
      >
        aomi
      </span>
    </span>
  );
}
