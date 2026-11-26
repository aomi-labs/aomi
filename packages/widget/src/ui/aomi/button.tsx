import { cn } from "@/lib/cn";
import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

/**
 * Aomi action buttons, built only from `aomi-*` tokens. `ui/button` keeps the
 * shadcn vocabulary for registry consumers; redesigned surfaces use this.
 * Use `aomiButton({ variant, size })` directly on links or Radix `asChild`
 * triggers that must render something other than a `<button>`.
 */
export const aomiButton = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border border-transparent font-medium transition-colors duration-[120ms] disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--aomi-action-primary)] text-[color:var(--aomi-on-action-primary)] hover:bg-[var(--aomi-action-primary-hover)]",
        secondary: "bg-aomi-surface-2 text-aomi-fg hover:bg-aomi-hover",
        ghost: "text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg",
        /** Quiet destructive entry point (e.g. a row's "Remove"). */
        danger:
          "bg-[var(--aomi-action-danger-bg)] text-[color:var(--aomi-action-danger-fg)] hover:bg-[var(--aomi-action-danger-hover)]",
        /** The committing destructive action, e.g. inside a confirm. */
        "danger-fill":
          "bg-aomi-danger-strong text-aomi-on-danger hover:bg-[color-mix(in_srgb,var(--aomi-danger-strong)_90%,black)]",
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
