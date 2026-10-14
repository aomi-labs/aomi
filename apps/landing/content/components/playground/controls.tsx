"use client";

import type { FC } from "react";

// Brand control primitives per the aomi-design inventory (№04 / №05).
// Chip and segment pill are the same 12px rounded-full object — a chip sits
// unjoined on the page, a segment sits joined on a sunken surface-2 track.
// Colors ride the page-level vars set by the playground roots:
// --surface-2, --accent-strong, --on-accent (plus the fd-* aliases).

/** Segmented control: joined single-select; active segment is an accent pill. */
export const Segmented: FC<{
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}> = ({ options, value, onChange }) => (
  <div className="border-fd-border inline-flex rounded-full border bg-[var(--surface-2)] p-[3px]">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        aria-pressed={value === o.value}
        onClick={() => onChange(o.value)}
        className={`rounded-full px-3.5 py-[5px] text-xs transition-colors ${
          value === o.value
            ? "bg-[var(--accent-strong)] font-medium text-[var(--on-accent)]"
            : "text-fd-muted-foreground hover:text-fd-foreground"
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

/** Filter/toggle chip: unjoined pill; selected takes the accent-strong fill. */
export const ToggleChip: FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <button
    type="button"
    aria-pressed={checked}
    onClick={() => onChange(!checked)}
    className={`rounded-full border px-3.5 py-[5px] text-xs transition-colors ${
      checked
        ? "border-transparent bg-[var(--accent-strong)] font-medium text-[var(--on-accent)]"
        : "border-fd-border text-fd-muted-foreground hover:text-fd-foreground bg-[var(--surface-2)]"
    }`}
  >
    {label}
  </button>
);
