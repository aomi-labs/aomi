import type { ComponentProps } from "react";

type AomiLogoProps = ComponentProps<"span"> & {
  markClassName?: string;
  wordmarkClassName?: string;
};

/** Canonical Aomi lockup from the shared design system. */
export function AomiLogo({
  className = "",
  markClassName = "h-[1em] w-[1em]",
  wordmarkClassName = "",
  ...props
}: AomiLogoProps) {
  return (
    <span
      className={`inline-flex items-center gap-[0.34em] ${className}`}
      {...props}
    >
      <img
        src="/assets/images/bubble.svg"
        alt=""
        aria-hidden="true"
        className={`shrink-0 ${markClassName}`}
      />
      <span
        className={`leading-none font-semibold tracking-[-0.025em] ${wordmarkClassName}`}
        style={{
          fontFamily:
            'var(--font-source-serif-4, "Source Serif 4"), ui-serif, Georgia, Cambria, serif',
        }}
      >
        aomi
      </span>
    </span>
  );
}
