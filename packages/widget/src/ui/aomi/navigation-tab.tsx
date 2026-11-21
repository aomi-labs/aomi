import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

/** A standalone section or filter choice. Selection follows the sidebar palette. */
export function NavigationTab({
  active,
  className,
  ...props
}: ComponentPropsWithRef<"button"> & { active: boolean }) {
  return (
    <button
      {...props}
      type="button"
      aria-pressed={active}
      className={cn(
        "aomi-nav-row text-aomi-muted hover:text-aomi-fg focus-visible:ring-aomi-ring inline-flex shrink-0 items-center gap-[7px] whitespace-nowrap rounded-[8px] px-[11px] py-[7px] text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset",
        active && "text-aomi-fg font-medium",
        className,
      )}
    />
  );
}
