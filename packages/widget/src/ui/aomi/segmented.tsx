"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@aomi-labs/react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

/**
 * A 2–4 option single-choice switch (theme, period, level). It is a radio
 * group: one tab stop, arrow keys / Home / End move and select, and the
 * selection follows focus.
 */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  size = "md",
  fullWidth = false,
  disabled = false,
  className,
}: {
  /** Accessible name of the group, e.g. "Theme". */
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** md = h-8 track (default), sm = h-7. */
  size?: "sm" | "md";
  /** Stretch across the container with equal-width segments. */
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = (index: number) => !disabled && !options[index]?.disabled;
  const selectedIndex = options.findIndex(
    (option, index) => option.value === value && enabled(index),
  );
  const tabStop =
    selectedIndex >= 0
      ? selectedIndex
      : options.findIndex((_, index) => enabled(index));

  const select = (index: number) => {
    refs.current[index]?.focus();
    if (options[index].value !== value) onChange(options[index].value);
  };

  const step = (from: number, delta: 1 | -1) => {
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index =
        (from + delta * offset + options.length * offset) % options.length;
      if (enabled(index)) return index;
    }
    return from;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = step(from, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = step(from, -1);
    } else if (event.key === "Home") {
      next = step(options.length - 1, 1);
    } else if (event.key === "End") {
      next = step(0, -1);
    }
    if (next === null) return;
    event.preventDefault();
    select(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn(
        "bg-aomi-surface-2 rounded-control gap-0.5 p-[3px]",
        fullWidth ? "flex w-full" : "inline-flex",
        className,
      )}
    >
      {options.map((option, index) => {
        const checked = index === selectedIndex;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={!enabled(index)}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "flex items-center justify-center whitespace-nowrap rounded-lg px-[11px] text-[12px] font-medium leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              size === "sm" ? "h-[22px]" : "h-[26px]",
              fullWidth && "flex-1",
              checked
                ? "bg-aomi-raised text-aomi-fg ring-aomi-border ring-1"
                : "text-aomi-muted hover:text-aomi-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
