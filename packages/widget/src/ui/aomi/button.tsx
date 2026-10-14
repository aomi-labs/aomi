import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@aomi-labs/react";

/**
 * Aomi action buttons, built only from `aomi-*` tokens. `ui/button` keeps the
 * shadcn vocabulary for registry consumers; redesigned surfaces use this.
 * Use `aomiButton({ variant, size })` directly on links or Radix `asChild`
 * triggers that must render something other than a `<button>`.
 */
export const aomiButton = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border font-medium transition-[color,background-color,border-color,opacity,transform] duration-[120ms] active:scale-[.98] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-aomi-fg text-aomi-bg border-transparent hover:opacity-90",
        // The account chip's recipe: white, hairline border, a faint lift;
        // hover darkens the border instead of filling.
        secondary:
          "border-aomi-border bg-aomi-raised text-aomi-fg shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-aomi-muted/60",
        ghost:
          "text-aomi-muted border-transparent hover:bg-aomi-hover hover:text-aomi-fg",
        /** Quiet destructive entry point (e.g. a row's "Remove"). */
        danger:
          "border-aomi-border bg-aomi-raised text-aomi-danger shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-aomi-danger/40 hover:bg-aomi-danger/5",
        /** The committing destructive action, e.g. inside a confirm. */
        "danger-fill":
          "bg-aomi-danger-strong text-aomi-on-danger border-transparent hover:opacity-90",
      },
      // Radius and type live per size, not in the base: tailwind-merge cannot
      // see that `rounded-control` and `rounded-lg` (or `type-control` and a
      // `text-*` size) conflict, so a base default would never be replaced.
      size: {
        md: "rounded-control type-control h-8 px-3",
        sm: "h-7 rounded-[8px] px-2.5 text-[12px] leading-4",
        icon: "rounded-control size-8",
        "icon-sm": "size-7 rounded-[8px]",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type AomiButtonProps = ComponentProps<"button"> &
  VariantProps<typeof aomiButton>;

export function AomiButton({
  variant,
  size,
  className,
  type = "button",
  ...props
}: AomiButtonProps) {
  return (
    <button
      type={type}
      className={cn(aomiButton({ variant, size }), className)}
      {...props}
    />
  );
}
