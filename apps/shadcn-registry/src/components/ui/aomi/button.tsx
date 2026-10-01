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
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-aomi-fg text-aomi-bg border-transparent hover:opacity-90",
        secondary:
          "border-aomi-border bg-aomi-raised text-aomi-fg hover:bg-aomi-hover",
        ghost:
          "text-aomi-muted border-transparent hover:bg-aomi-hover hover:text-aomi-fg",
        /** Quiet destructive entry point (e.g. a row's "Remove"). */
        danger:
          "border-aomi-border bg-aomi-raised text-aomi-danger hover:bg-aomi-danger/10",
        /** The committing destructive action, e.g. inside a confirm. */
        "danger-fill":
          "bg-aomi-danger-strong text-aomi-on-danger border-transparent hover:opacity-90",
      },
      // Radius and type live per size, not in the base: tailwind-merge cannot
      // see that `rounded-control` and `rounded-lg` (or `type-control` and a
      // `text-*` size) conflict, so a base default would never be replaced.
      size: {
        md: "rounded-control type-control h-8 px-3",
        sm: "h-7 rounded-lg px-2.5 text-[12px] leading-4",
        icon: "rounded-control size-8",
        "icon-sm": "size-7 rounded-lg",
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
