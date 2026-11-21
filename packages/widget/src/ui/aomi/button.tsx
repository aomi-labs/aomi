import { cn } from "@/lib/cn";
import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

/** Shared appearance for action buttons, links, and slotted controls. */
export const actionAppearance = {
  primary: "aomi-action-fill [--action-bg:var(--aomi-action-primary)] text-[color:var(--aomi-control-ink)]",
  secondary: "bg-aomi-surface-2 hover:bg-aomi-hover active:bg-aomi-hover text-[color:var(--aomi-control-ink)]",
  "on-band": "bg-white text-black hover:bg-aomi-surface-2 dark:hover:bg-white",
  ghost: "text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg active:bg-aomi-hover",
  danger: "aomi-action-fill [--action-bg:var(--aomi-action-danger-bg)] text-[color:var(--aomi-control-ink)]",
  "danger-fill": "aomi-action-fill [--action-bg:var(--aomi-danger-strong)] text-aomi-on-danger",
};

export const aomiButton = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] font-medium transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aomi-ring disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: actionAppearance,
      size: {
        md: "type-control h-8 px-3",
        sm: "h-7 px-2.5 text-[12px] leading-4",
        icon: "size-8",
        "icon-sm": "size-7",
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
