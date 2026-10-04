"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@build/lib/utils";

/**
 * UI-only Create composer model list.
 * Hardcoded — does not fetch models or invent a live backend catalog.
 */
const MODEL_OPTIONS = [
  {
    id: "aomi",
    label: "Aomi",
    available: true,
    hint: "Build default",
  },
] as const;

const CURRENT_MODEL_ID = "aomi";

type ComposerModelPickerProps = {
  className?: string;
  disabled?: boolean;
};

/**
 * Show the configured Build model until a supported catalog is available.
 */
export function ComposerModelPicker({
  className,
  disabled = false,
}: ComposerModelPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const current = MODEL_OPTIONS.find((m) => m.id === CURRENT_MODEL_ID)!;

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "context-chip gap-1 pr-1.5",
          open && "context-chip--open",
          disabled && "pointer-events-none opacity-50",
        )}
        title="Model for Build"
      >
        <span className="text-foreground font-medium">{current.label}</span>
        <ChevronDown
          className={cn(
            "size-3.5 opacity-60 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          id={menuId}
          role="listbox"
          aria-label="Models"
          className="border-border bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-2 w-[220px] overflow-hidden rounded-xl border shadow-lg"
        >
          <div className="border-border/60 border-b px-3 py-2">
            <p className="text-foreground text-[12px] font-medium">Model</p>
            <p className="text-dim text-[11px] leading-snug">
              Build uses its configured model. Other model choices are not
              available here yet.
            </p>
          </div>

          <ul className="p-1">
            {MODEL_OPTIONS.map((option) => {
              const selected = option.id === CURRENT_MODEL_ID;
              return (
                <li key={option.id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    disabled={!option.available}
                    onClick={() => {
                      if (!option.available) return;
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-150",
                      option.available
                        ? "text-foreground hover:bg-accent-hover"
                        : "text-dim cursor-not-allowed opacity-70",
                      selected && "menu-item--selected",
                    )}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {selected ? (
                        <Check className="text-foreground size-3.5" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {option.label}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[11px]",
                        option.available ? "text-dim" : "text-hint",
                      )}
                    >
                      {option.hint}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
