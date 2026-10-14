"use client";

// Shared thread-mode slide bar: the sliding pill toggle plus the `?` whose
// tooltip carries the explanation. Used on each bot card (bots-view) and in
// the "How Telegram bots work" explainer. Lives here rather than in
// features/operate because bots-view already imports from
// features/integrations — the other direction would be a cycle.

import { HelpBadge } from "@/components/help-badge";
import { cn } from "@/lib/class-names";

export function ThreadModeToggle({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const isMulti = value === "multi";
  return (
    <div
      role="radiogroup"
      aria-label="Thread mode"
      className={cn(
        "border-border bg-surface relative inline-flex h-9 rounded-full border p-1",
        disabled && "opacity-60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "bg-accent-selected absolute inset-y-1 left-1 w-32 rounded-full transition-transform duration-200 ease-out",
          isMulti && "translate-x-full",
        )}
      />
      {(
        [
          ["single", "Single thread"],
          ["multi", "Multiple threads"],
        ] as const
      ).map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          disabled={disabled}
          onClick={() => onChange(mode)}
          className={cn(
            "relative z-10 w-32 rounded-full text-xs font-medium transition-colors duration-200",
            value === mode
              ? "text-accent-selected-foreground"
              : "text-dim hover:text-foreground",
            disabled && "cursor-not-allowed",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The toggle with the `?` on its right: the explanation lives in the
 *  tooltip. */
export function ThreadModeControl({
  value,
  onChange,
  disabled,
  tooltip,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  tooltip?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <ThreadModeToggle value={value} onChange={onChange} disabled={disabled} />
      <HelpBadge label="About thread mode">
        {tooltip ??
          "Single thread keeps the bot to one conversation. Multiple threads lets users switch threads with /thread."}
      </HelpBadge>
    </div>
  );
}
