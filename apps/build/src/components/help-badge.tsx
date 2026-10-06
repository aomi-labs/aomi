"use client";

import { useId } from "react";

import { cn } from "@/lib/class-names";

export function HelpBadge({
  label,
  children,
  side = "top",
  align = "start",
}: {
  label: string;
  children: React.ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
}) {
  const tooltipId = useId();

  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={tooltipId}
        style={{ borderRadius: "9999px" }}
        className="border-aomi-border text-aomi-muted hover:border-aomi-muted hover:text-aomi-fg inline-flex h-[18px] w-[18px] cursor-help items-center justify-center rounded-full border text-[11px] font-medium leading-none"
      >
        ?
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={cn(
          "border-aomi-overlay-border bg-aomi-surface-2 text-aomi-fg pointer-events-none invisible absolute z-30 w-[190px] rounded-[8px] border px-2.5 py-2 text-left text-[11px] font-normal normal-case leading-[1.35] tracking-normal group-focus-within:visible group-hover:visible",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          align === "start" && "left-0",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "end" && "right-0",
        )}
      >
        {children}
      </span>
    </span>
  );
}
