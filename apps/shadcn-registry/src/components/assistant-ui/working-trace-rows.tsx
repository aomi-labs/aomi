"use client";

import { type FC, useState } from "react";
import { TextMessagePartProvider } from "@assistant-ui/react";
import { CheckIcon, ChevronRightIcon, XIcon } from "lucide-react";

import { cn } from "@aomi-labs/react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import type {
  InterpretedToolStep,
  ToolChip,
} from "@/components/assistant-ui/tool-interpreter";

/**
 * The primitive rows shared by the mother trace (`working-trace.tsx`) and a
 * delegated agent's subtree (`working-agent.tsx`).
 *
 * They live here rather than in `working-trace.tsx` because the trace imports
 * `WorkingAgent` and the agent renders these rows — keeping them in a leaf
 * module avoids an import cycle between the two. Nothing in here knows about
 * transcript parts or task runs: callers hand over an already-interpreted step.
 */

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const toDetailString = (result: unknown): string =>
  typeof result === "string" ? result : JSON.stringify(result, null, 2);

/**
 * The expanded args/result box. Capped to ~20 lines (`max-h-[26rem]`) and made
 * scrollable beyond that, so a long tool payload (e.g. a full transaction dump
 * of raw calldata) scrolls in place instead of marching the trace — and the
 * answer below it — far down the page.
 */
export const DETAIL_BOX_CLASS =
  "border-aomi-border bg-aomi-surface text-aomi-muted max-h-[26rem] overflow-auto whitespace-pre-wrap break-words rounded-md border p-2 font-mono text-xs leading-relaxed";

const MAX_VISIBLE_CHIPS = 4;

/** Base + per-chip stagger for the left-to-right chip cascade (ms). */
const CHIP_BASE_DELAY_MS = 100;
const CHIP_STEP_DELAY_MS = 70;

export const ToolChipView: FC<{
  chip: ToolChip;
  index: number;
  animate: boolean;
}> = ({ chip, index, animate }) => {
  const Glyph = chip.icon;
  return (
    <span
      className={cn(
        "bg-aomi-surface-2 text-aomi-muted inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs tabular-nums leading-4",
        animate &&
          "animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-300 motion-reduce:animate-none",
      )}
      style={
        animate
          ? {
              animationDelay: `${CHIP_BASE_DELAY_MS + index * CHIP_STEP_DELAY_MS}ms`,
            }
          : undefined
      }
    >
      {chip.dot ? (
        <span
          className="size-[5px] shrink-0 rounded-full"
          style={{ backgroundColor: chip.dot }}
          aria-hidden="true"
        />
      ) : (
        !Glyph && (
          <span
            className="bg-aomi-accent size-[5px] shrink-0 rounded-full"
            aria-hidden="true"
          />
        )
      )}
      {Glyph && <Glyph className="text-aomi-muted size-3 shrink-0" />}
      <span className="truncate">{chip.label}</span>
    </span>
  );
};

/**
 * One interpreted tool call, as a flat row: marker · title · chips, with an
 * optional click-to-open `<pre>` detail holding the raw args/result.
 *
 * `done` drives the check/X marker (the interpreted icon shows until then) and
 * `active` is the single live signal — the title shimmers while it is set.
 */
export const ToolStepRow: FC<{
  interpretation: InterpretedToolStep;
  argsText?: string;
  detailText?: string;
  done: boolean;
  active: boolean;
  animate: boolean;
  className?: string;
}> = ({
  interpretation,
  argsText,
  detailText,
  done,
  active,
  animate,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const hasDetail = detailText !== undefined || argsText !== undefined;
  const Icon = interpretation.icon;
  const shownChips =
    interpretation.chips.length > MAX_VISIBLE_CHIPS
      ? interpretation.chips.slice(0, MAX_VISIBLE_CHIPS)
      : interpretation.chips;
  const overflow = interpretation.chips.length - shownChips.length;

  return (
    <div
      className={cn(
        "aui-working-step",
        animate &&
          "animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none",
        className,
      )}
    >
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen((o) => !o)}
        className="aui-working-step-header group/step flex w-full items-center gap-2.5 py-1 text-left disabled:cursor-default"
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          {done && !active ? (
            interpretation.failed ? (
              <XIcon className="text-aomi-danger size-3.5" />
            ) : (
              <CheckIcon className="text-aomi-success size-3.5" />
            )
          ) : (
            <Icon className="text-aomi-muted size-3.5" />
          )}
        </span>
        <span
          className={cn(
            "flex-1 truncate font-mono text-[13px]",
            active ? "aui-working-shimmer font-medium" : "text-aomi-fg",
          )}
        >
          {interpretation.title}
        </span>
        {/* Detail affordance stays quiet until the row is hovered (or open). */}
        {hasDetail && (
          <ChevronRightIcon
            className={cn(
              "text-aomi-muted/60 size-3 shrink-0 transition-[transform,opacity]",
              open
                ? "rotate-90 opacity-100"
                : "opacity-0 group-hover/step:opacity-100",
            )}
          />
        )}
      </button>

      {interpretation.chips.length > 0 && (
        <div className="aui-working-step-chips mb-1 ml-[26px] mt-2 flex max-w-full flex-wrap items-center gap-1.5">
          {shownChips.map((chip, i) => (
            <ToolChipView
              key={`${chip.label}-${i}`}
              chip={chip}
              index={i}
              animate={animate}
            />
          ))}
          {overflow > 0 && (
            <span
              className={cn(
                "bg-aomi-surface-2 text-aomi-muted inline-flex items-center rounded-full px-2.5 py-1 font-mono text-xs leading-4",
                animate &&
                  "animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-300 motion-reduce:animate-none",
              )}
              style={
                animate
                  ? {
                      animationDelay: `${CHIP_BASE_DELAY_MS + shownChips.length * CHIP_STEP_DELAY_MS}ms`,
                    }
                  : undefined
              }
            >
              +{overflow} more
            </span>
          )}
        </div>
      )}

      {open && hasDetail && (
        <div className="aui-working-step-detail mb-1.5 ml-[26px] mt-4 flex flex-col gap-1.5">
          {argsText && <pre className={DETAIL_BOX_CLASS}>{argsText}</pre>}
          {detailText !== undefined && (
            <pre className={DETAIL_BOX_CLASS}>{detailText}</pre>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * An interstitial line — the model (or a delegated child) talking between tool
 * calls. Rendered as a muted markdown note with a dot marker in the icon column
 * so it lines up with the tool steps on the rail (in order, inside the trace —
 * not in the answer). `active` makes it the single live signal.
 */
export const WorkingNote: FC<{
  text: string;
  animate: boolean;
  active?: boolean;
}> = ({ text, animate, active = false }) => (
  <div
    className={cn(
      "aui-working-note flex items-start gap-2 py-1",
      animate &&
        "animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none",
    )}
  >
    <span
      className="relative flex h-[19px] w-4 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      <span className="bg-aomi-muted/60 size-1 rounded-full" />
    </span>
    <div
      className={cn(
        "min-w-0 flex-1 text-[13px] leading-relaxed [&_p+p]:mt-2 [&_p]:my-0",
        active ? "aui-working-shimmer font-medium" : "text-aomi-muted",
      )}
    >
      <TextMessagePartProvider text={text}>
        <MarkdownText />
      </TextMessagePartProvider>
    </div>
  </div>
);
