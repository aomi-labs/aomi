import { cn } from "@/lib/cn";
import type { ComponentProps } from "react";


/** A small on/off control for settings rows. */
export function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: Omit<ComponentProps<"button">, "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "focus-visible:ring-aomi-accent relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
        checked ? "bg-aomi-fg" : "bg-aomi-border",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "bg-aomi-bg size-3 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.15)] transition-transform duration-[120ms] motion-reduce:transition-none",
          checked ? "translate-x-3.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
