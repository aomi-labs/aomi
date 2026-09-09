"use client";

import { type FC, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  TextMessagePartProvider,
  useMessage,
  type TextMessagePart,
  type ToolCallMessagePart,
} from "@assistant-ui/react";
import {
  CheckIcon,
  ChevronDownIcon,
  CogIcon,
  LightbulbIcon,
  MoreHorizontalIcon,
  XIcon,
} from "lucide-react";

import {
  cn,
  useOptionalAomiRuntime,
  useThreadTaskRuns,
  type TaskRunState,
} from "@aomi-labs/react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { interpretToolStep } from "@/components/assistant-ui/tool-interpreter";
import {
  agentStepCount,
  WorkingAgent,
} from "@/components/assistant-ui/working-agent";
import {
  prefersReducedMotion,
  toDetailString,
  ToolStepRow,
  WorkingNote,
} from "@/components/assistant-ui/working-trace-rows";

/**
 * Working trace — the chain-of-thought UI.
 *
 * A merged assistant turn (see `mergeAssistantTurns` in @aomi-labs/react) is one
 * message with ordered parts `[tool-call, …, text]`. We split it:
 *   • tool-call parts → a collapsible "Working" trace, one line per step
 *   • the trailing text → the final answer, streamed on its own
 *
 * "Still working" is carried entirely by the shimmer on the *last* step: it keeps
 * sweeping whenever the turn is running, including the common case where a tool
 * call has finished and we're just waiting on the model to say what's next. When
 * the turn completes the trace collapses to "Worked for Ns" and the answer is
 * revealed. Plain replies with no tool calls remain buffered while running,
 * then render immediately once the turn settles.
 */

const formatDuration = (seconds: number): string => {
  const totalSeconds = Math.max(1, Math.round(seconds));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s}s`;
};

/** useLayoutEffect on the client, useEffect on the server (dodges the SSR warning). */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Matches the header collapse (duration-300 ease-out). */
const WINDOW_ANIM_MS = 300;

/**
 * Whenever the trace is open — live or after completion — it is capped to this
 * height so a long run of steps doesn't march down the whole screen. Newest
 * steps stay pinned at the bottom; older ones remain available by scrolling the
 * trace under edge fades (see `.aui-working-trace-edge-fade`). Sized to show
 * ~5 full steps with the adjacent rows dissolving at the edges. "Show all"
 * remains available when an uncapped overview is more useful.
 */
const WORKING_WINDOW_PX = 260;

/**
 * One tool call of the mother's own trace. The presentation lives in
 * `ToolStepRow` (shared with a delegated agent's child steps); this wrapper
 * only unpacks the transcript part.
 */
const WorkingStep: FC<{
  tool: ToolCallMessagePart;
  relatedResults?: unknown[];
  active: boolean;
  animate: boolean;
  live: boolean;
}> = ({ tool, relatedResults, active, animate, live }) => {
  const done = tool.result !== undefined;
  const argsText =
    tool.argsText && tool.argsText !== "undefined" ? tool.argsText : undefined;

  return (
    <ToolStepRow
      interpretation={interpretToolStep({
        toolName: tool.toolName,
        argsText,
        result: tool.result,
        relatedResults,
      })}
      argsText={argsText}
      detailText={done ? toDetailString(tool.result) : undefined}
      done={done}
      active={active}
      animate={animate}
      animateUpdates={live}
    />
  );
};

/**
 * One rendered row of the trace: a tool step, a run of interstitial talk, or a
 * delegated agent (whose own steps hang off it).
 */
type TraceItem =
  | { kind: "tool"; tool: ToolCallMessagePart; key: string }
  | { kind: "note"; text: string; key: string }
  | {
      kind: "agent";
      agentId: string;
      /** Present once the mother's `task` part has landed in the transcript. */
      tool?: ToolCallMessagePart;
      /** Present while the live sidecar knows about the run. */
      run?: TaskRunState;
      /** Appearance order within the turn — picks the row's identity color. */
      order: number;
      key: string;
    };

/** Child steps an agent row contributes to the header/pill step count. */
const childStepCount = (item: TraceItem): number =>
  item.kind === "agent" ? agentStepCount(item.run) : 0;

const taskResultAgentIds = (result: unknown): string[] => {
  if (!result || typeof result !== "object") return [];
  const record = result as Record<string, unknown>;
  const candidates: unknown[] = [record.agent_id];
  if (record.error && typeof record.error === "object") {
    candidates.push((record.error as Record<string, unknown>).agent_id);
  }
  if (Array.isArray(record.results)) {
    for (const item of record.results) {
      if (!item || typeof item !== "object") continue;
      const child = item as Record<string, unknown>;
      candidates.push(child.agent_id);
      if (child.error && typeof child.error === "object") {
        candidates.push((child.error as Record<string, unknown>).agent_id);
      }
    }
  }
  return [
    ...new Set(
      candidates.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  ];
};

const ThinkingStatusGlyph: FC = () => (
  <span
    aria-hidden="true"
    className="aui-thinking-glyph text-aomi-accent flex size-4 shrink-0 items-center justify-center"
  >
    <LightbulbIcon className="aui-thinking-bulb size-[15px] stroke-[1.8]" />
  </span>
);

const WorkingStatusGlyph: FC = () => (
  <span
    aria-hidden="true"
    className="aui-working-glyph text-aomi-accent flex size-4 shrink-0 items-center justify-center"
  >
    <CogIcon className="aui-working-cog size-[15px] stroke-[1.8]" />
  </span>
);

const WORKING_STATUS_TEXT_CLASS = "text-[13px] font-medium leading-none";
const WORKING_COLLAPSED_CHIP_CLASS =
  "border-aomi-border bg-aomi-surface h-8 w-fit rounded-full pl-3 pr-4";

type WorkingTraceOutcome = "running" | "complete" | "failed" | "interrupted";

export const WorkingTrace: FC<{
  running: boolean;
  outcome?: WorkingTraceOutcome;
  items: TraceItem[];
  revealed: number;
  /** Final-answer playback has begun, so the open trace may fold away. */
  collapseReady?: boolean;
  /**
   * When the turn actually started, if known. The card can mount long after
   * the work began (the transcript part for a delegation only lands at the
   * end), so mount time alone under-reports "Orchestrated for Ns" badly.
   */
  startedAtMs?: number;
}> = ({
  running,
  outcome = running ? "running" : "complete",
  items,
  revealed,
  collapseReady = true,
  startedAtMs,
}) => {
  const [open, setOpen] = useState(running);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [hasContentBelow, setHasContentBelow] = useState(false);
  // True only while the expand/collapse height tween is in flight; keeps the
  // viewport clipped and suppresses the edge fades so the animation reads cleanly.
  const [animating, setAnimating] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  // The inner content's natural height, read for overflow detection and the
  // expand/collapse tween. Measuring the body keeps the result stable while the
  // viewport is capped or its max-height animation is in flight.
  const bodyRef = useRef<HTMLDivElement>(null);
  // Live traces follow new steps while the reader is at the bottom. Scrolling up
  // opts out until they return to the newest step, so a tool update never yanks
  // an older row out from under the pointer.
  const followLatestRef = useRef(true);
  const prevOpen = useRef(open);
  const prevWindowed = useRef(!expanded);
  const prevExpanded = useRef(expanded);
  const animRef = useRef<Animation | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const wasRunning = useRef(running);
  const startedAt = useRef<number>(startedAtMs ?? Date.now());
  // An earlier anchor can arrive after mount (e.g. the first task_started
  // event lands a beat later); only ever move the start backwards.
  if (startedAtMs !== undefined && startedAtMs < startedAt.current) {
    startedAt.current = startedAtMs;
  }

  // How many items have already played their entrance. Survives the body's
  // collapse/remount (this component stays mounted), so an item only animates
  // the first time it's revealed — reopening a finished trace shows it static.
  const animatedCount = useRef(0);
  useEffect(() => {
    if (revealed > animatedCount.current) animatedCount.current = revealed;
  }, [revealed]);

  // The trace has fully caught up once every queued item has been revealed.
  const fullyRevealed = !running && revealed >= items.length;

  // A delegated agent remains one top-level trace item while its nested step
  // stream grows. Track that growth separately: `revealed` does not change for
  // those updates, but the viewport still needs to follow the newest child step.
  const revealedChildStepCount = items.reduce(
    (total, item, index) =>
      index < revealed && item.kind === "agent"
        ? total + (item.run?.steps.length ?? 0)
        : total,
    0,
  );

  // Cap the open trace to a scrolling window — live and after completion alike:
  // the newest steps stay pinned at the bottom and older ones remain wheel/touch/
  // keyboard-scrollable under edge fades instead of marching down the page.
  // Expanding ("Show all") still lifts the cap. The fades only engage once
  // content actually overflows, so a short trace is never faded.
  const windowed = !expanded;
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !windowed) {
      setOverflowing(false);
      return;
    }
    // Compare the full content height to the cap directly, so the reading stays
    // stable while the expand/collapse height animation is mid-flight — otherwise
    // the "Show all" control would flicker out.
    setOverflowing(body.offsetHeight - WORKING_WINDOW_PX > 24);
  }, [windowed, revealed, revealedChildStepCount, open]);

  const handleViewportScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distanceFromBottom =
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    followLatestRef.current = distanceFromBottom <= 8;
    setHasContentBelow(distanceFromBottom > 8);
  };

  // Animate the expand/collapse of the window height (cap ⇄ full content),
  // mirroring the header's collapse feel. Plain CSS can't transition to/from the
  // uncapped `auto` height, so we drive it with the Web Animations API: measure
  // the natural height and tween `max-height` between the cap and full. WAAP
  // overrides the declarative style while playing and reverts to it on finish —
  // which already matches the tween's end value, so it settles seamlessly. Runs
  // in a layout effect (before paint, so the first frame is already clipped) and
  // only when `expanded` actually flips — not on mount, streaming re-renders, or
  // under reduced motion.
  useIsomorphicLayoutEffect(() => {
    if (prevExpanded.current === expanded) return;
    prevExpanded.current = expanded;
    const viewport = viewportRef.current;
    const body = bodyRef.current;
    if (!viewport || !body || prefersReducedMotion()) return;
    const cap = WORKING_WINDOW_PX;
    const full = body.offsetHeight;
    const from = expanded ? cap : full;
    const to = expanded ? full : cap;
    animRef.current?.cancel();
    setAnimating(true);
    const anim = viewport.animate(
      [{ maxHeight: `${from}px` }, { maxHeight: `${to}px` }],
      { duration: WINDOW_ANIM_MS, easing: "ease-out" },
    );
    animRef.current = anim;
    const settle = () => {
      if (animRef.current !== anim) return;
      animRef.current = null;
      setAnimating(false);
    };
    anim.onfinish = settle;
    anim.oncancel = settle;
  }, [expanded]);

  // Start/restart a capped trace at its newest step. While it stays open, only
  // follow streamed additions when the reader has not scrolled away from the
  // bottom. This also restores the recent-step view after "Collapse to recent".
  useIsomorphicLayoutEffect(() => {
    const viewport = viewportRef.current;
    const reopened = open && !prevOpen.current;
    const collapsedToWindow = windowed && !prevWindowed.current;

    if (reopened || collapsedToWindow) followLatestRef.current = true;
    prevOpen.current = open;
    prevWindowed.current = windowed;

    if (!viewport || !open || !windowed || animating) return;
    if (followLatestRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
      setHasContentBelow(false);
    }
  }, [animating, open, revealed, revealedChildStepCount, windowed]);

  useEffect(() => () => animRef.current?.cancel(), []);

  useEffect(() => {
    if (wasRunning.current && !running) {
      // turn just finished: freeze the timer (collapse waits for full reveal)
      setElapsed((Date.now() - startedAt.current) / 1000);
    }
    wasRunning.current = running;
  }, [running]);

  // Auto-collapse only once final-answer playback has actually begun. An
  // awaiting Action temporarily marks the assistant message complete, but the
  // trace must stay open through approval and the resumed model turn.
  useEffect(() => {
    if (!fullyRevealed || !collapseReady) return;
    const timer = setTimeout(() => setOpen(false), 500);
    return () => clearTimeout(timer);
  }, [collapseReady, fullyRevealed]);

  const elapsedLabel =
    elapsed != null ? ` after ${formatDuration(elapsed)}` : "";
  const label =
    outcome === "running"
      ? "Working"
      : outcome === "complete"
        ? elapsed != null
          ? `Worked for ${formatDuration(elapsed)}`
          : "Worked it out"
        : `Stopped${elapsedLabel}`;

  // Keep the status treatment continuous from Thinking into Working. The newest
  // revealed step retains its contextual shimmer while the header consistently
  // communicates that the overall turn is still live.
  const activeIndex = running ? revealed - 1 : -1;
  const headerClass = running ? "aui-working-shimmer" : "text-aomi-fg";

  const visibleItems = items.slice(0, revealed);

  // Step count rule: every shown row counts as one step, and a delegated agent
  // row additionally contributes its child steps (its reported `stepCount`, or
  // the steps actually observed). So a turn of 3 mother steps around one agent
  // that ran 5 child steps reads "9 steps" — the agent row itself is a step.
  const stepCount = visibleItems.reduce(
    (total, item) => total + 1 + childStepCount(item),
    0,
  );

  return (
    // Keep one stable column in both states so the body has a real 0fr ⇄ 1fr
    // path to animate through. The closed shell is transparent and only its
    // compact header chip remains visible.
    <div
      className={cn(
        "aui-working-trace animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 mb-3 flex w-full origin-top-left flex-col overflow-hidden rounded-xl border transition-[border-color,background-color,box-shadow] duration-300 ease-out motion-reduce:animate-none motion-reduce:transition-none",
        open
          ? "border-aomi-border/70 bg-aomi-surface/25 shadow-[0_6px_20px_rgba(0,0,0,0.025)]"
          : "border-transparent bg-transparent shadow-none",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "aui-working-trace-header flex items-center gap-2 border text-left text-sm transition-[height,padding,border-radius,border-color,background-color] duration-300 ease-out motion-reduce:transition-none",
          open
            ? "bg-aomi-surface/65 h-10 w-full self-stretch rounded-[11px] border-transparent px-3.5"
            : cn(
                WORKING_COLLAPSED_CHIP_CLASS,
                "hover:border-aomi-muted/40 self-start",
              ),
        )}
      >
        {outcome === "running" ? (
          <WorkingStatusGlyph />
        ) : outcome === "failed" ? (
          <span className="flex size-4 shrink-0 items-center justify-center">
            <XIcon className="text-aomi-danger size-3.5" />
          </span>
        ) : outcome === "interrupted" ? (
          <span className="text-aomi-muted flex size-4 shrink-0 items-center justify-center">
            <MoreHorizontalIcon className="size-3.5" />
          </span>
        ) : (
          <span className="flex size-4 shrink-0 items-center justify-center">
            <CheckIcon className="text-aomi-success size-3.5" />
          </span>
        )}
        <span className={cn(WORKING_STATUS_TEXT_CLASS, headerClass)}>
          {label}
        </span>
        {stepCount > 0 ? (
          <span className="text-aomi-muted inline-flex items-center text-[11px] font-normal tabular-nums leading-none">
            {stepCount} {stepCount === 1 ? "step" : "steps"}
          </span>
        ) : null}
        {open && <span className="flex-1" />}
        <ChevronDownIcon
          className={cn(
            "text-aomi-muted size-3.5 shrink-0 transition-transform duration-300 ease-out motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Collapse animates the grid row from 1fr→0fr (plus a fade) instead of
          snapping shut. The body stays mounted so items never remount. */}
      <div
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "grid w-full transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-aomi-border/60 bg-aomi-bg/15 relative border-t">
            {windowed && overflowing && !animating && (
              <>
                <span
                  aria-hidden="true"
                  className="aui-working-trace-edge-fade-top pointer-events-none absolute inset-x-0 top-0 z-20 h-16"
                />
                {hasContentBelow && (
                  <span
                    aria-hidden="true"
                    className="aui-working-trace-edge-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 z-20 h-16"
                  />
                )}
              </>
            )}
            <div
              ref={viewportRef}
              onScroll={handleViewportScroll}
              tabIndex={windowed && overflowing ? 0 : undefined}
              aria-label={
                windowed && overflowing ? "Working trace steps" : undefined
              }
              className={cn(
                "aui-working-trace-viewport",
                windowed && !animating && "overflow-y-auto",
                animating && "overflow-hidden",
                windowed &&
                  overflowing &&
                  !animating &&
                  "aui-working-trace-scroll",
              )}
              style={{ maxHeight: windowed ? WORKING_WINDOW_PX : undefined }}
            >
              <div
                ref={bodyRef}
                className="aui-working-trace-body relative isolate flex flex-col gap-1 px-3.5 pb-3.5 pt-3 text-sm"
              >
                {visibleItems.map((item, i) => {
                  const animate = running && i >= animatedCount.current;
                  if (item.kind === "tool") {
                    return (
                      <WorkingStep
                        key={item.key}
                        tool={item.tool}
                        relatedResults={visibleItems
                          .slice(0, i)
                          .flatMap((previous) =>
                            previous.kind === "tool"
                              ? [previous.tool.result]
                              : [],
                          )}
                        active={i === activeIndex}
                        animate={animate}
                        live={running}
                      />
                    );
                  }
                  if (item.kind === "agent") {
                    return (
                      <WorkingAgent
                        key={item.key}
                        agentId={item.agentId}
                        run={item.run}
                        tool={item.tool}
                        order={item.order}
                        // A live agent row owns the trace's single live signal:
                        // it re-homes the shimmer onto its newest child (open)
                        // or onto its own summary line (folded).
                        active={i === activeIndex}
                        animate={animate}
                      />
                    );
                  }
                  return (
                    <WorkingNote
                      key={item.key}
                      text={item.text}
                      animate={animate}
                    />
                  );
                })}
              </div>
            </div>
          </div>
          {/* Below the window: while it's hiding older steps, offer a way to lift
              the cap; while expanded, offer the way back to just the recent steps.
              Shown live and after completion — the window persists either way. */}
          {((windowed && overflowing) || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="aui-working-trace-more text-aomi-muted hover:text-aomi-fg flex items-center gap-1.5 px-3.5 pb-3 text-xs"
            >
              <MoreHorizontalIcon className="size-3.5 shrink-0" />
              {expanded
                ? "Collapse to recent steps"
                : `Show all ${stepCount} steps`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const MinimalWorkingTrace: FC = () => (
  <div
    role="status"
    aria-label="Aomi is thinking"
    className={cn(
      "aui-working-trace-start animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 mb-3 flex origin-top-left items-center gap-2 border duration-300 ease-out motion-reduce:animate-none",
      WORKING_COLLAPSED_CHIP_CLASS,
    )}
  >
    <ThinkingStatusGlyph />
    <span className={cn(WORKING_STATUS_TEXT_CLASS, "aui-working-shimmer")}>
      Thinking
    </span>
  </div>
);

const collectText = (parts: TextMessagePart[]): string =>
  parts
    .map((part) => part.text)
    .join("\n\n")
    .trim();

/**
 * The final answer is deliberately buffered while tools are running because a
 * text part is provisional until the last tool call lands. Once the turn has
 * settled, reveal that buffered answer with a lightweight synthetic stream so
 * it hands off naturally from the trace instead of appearing in one paint.
 *
 * The cadence scales with answer length and tops out at a few seconds: short
 * answers still feel typed, while long reports do not make the reader wait.
 */
const ANSWER_STREAM_TICK_MS = 20;
const ANSWER_STREAM_MS_PER_CHARACTER = 5.5;
const ANSWER_STREAM_MIN_MS = 180;
const ANSWER_STREAM_MAX_MS = 1400;

const answerStreamChunkSize = (length: number): number => {
  const duration = Math.min(
    ANSWER_STREAM_MAX_MS,
    Math.max(ANSWER_STREAM_MIN_MS, length * ANSWER_STREAM_MS_PER_CHARACTER),
  );
  return Math.max(1, Math.ceil(length / (duration / ANSWER_STREAM_TICK_MS)));
};

const useProgressiveAnswer = (
  text: string,
  animate: boolean,
): { text: string; streaming: boolean } => {
  const reduced = prefersReducedMotion();
  const shouldAnimate = animate && !reduced;
  const [visibleLength, setVisibleLength] = useState(() =>
    shouldAnimate ? 0 : text.length,
  );

  useEffect(() => {
    if (!shouldAnimate) {
      setVisibleLength(text.length);
      return;
    }
    // Content is append-only in normal operation. The clamp also handles a
    // reconciliation replacing it with a shorter canonical answer.
    setVisibleLength((current) => Math.min(current, text.length));
  }, [shouldAnimate, text.length]);

  useEffect(() => {
    if (!shouldAnimate || visibleLength >= text.length) return;
    const chunk = answerStreamChunkSize(text.length);
    const timer = setTimeout(
      () =>
        setVisibleLength((current) => Math.min(text.length, current + chunk)),
      ANSWER_STREAM_TICK_MS,
    );
    return () => clearTimeout(timer);
  }, [shouldAnimate, text.length, visibleLength]);

  return {
    text: text.slice(0, visibleLength),
    streaming: shouldAnimate && visibleLength < text.length,
  };
};

const RenderedText: FC<{ text: string }> = ({ text }) => {
  return (
    <TextMessagePartProvider text={text}>
      <MarkdownText />
    </TextMessagePartProvider>
  );
};

export const ProgressiveRenderedText: FC<{
  text: string;
  animate: boolean;
}> = ({ text, animate }) => {
  const progressive = useProgressiveAnswer(text, animate);
  return (
    <div aria-busy={progressive.streaming || undefined}>
      <RenderedText text={progressive.text} />
    </div>
  );
};

/**
 * Reconcile the ordered transcript with the live delegation sidecar.
 *
 * A task exists in the sidecar before its transcript tool part arrives. Once
 * that part does arrive, it replaces the synthetic row at the transcript's
 * chronological position instead of being appended again at the bottom. This
 * matters when a failed child is followed by successful parent work: the
 * failure remains useful history without looking like the final active step.
 */
export const buildTraceItems = (
  content: readonly (TextMessagePart | ToolCallMessagePart)[],
  liveDelegations: readonly TaskRunState[],
): TraceItem[] => {
  const items: TraceItem[] = [];
  const runsByAgentId = new Map(
    liveDelegations.map((run) => [run.agentId, run] as const),
  );
  const taskParts = content.filter(
    (part): part is ToolCallMessagePart =>
      part.type === "tool-call" && part.toolName === "task",
  );
  const occurrences = new Map<string, number>();
  for (const part of taskParts) {
    for (const agentId of taskResultAgentIds(part.result)) {
      occurrences.set(agentId, (occurrences.get(agentId) ?? 0) + 1);
    }
  }
  const consumedRuns = new Set<TaskRunState>();
  const invocationKey = (callId: string, agentId: string) =>
    `agent-${JSON.stringify([callId, agentId])}`;
  let agentOrder = 0;

  content.forEach((part, i) => {
    if (part.type === "tool-call") {
      if (part.toolName === "task") {
        const resultAgentIds = taskResultAgentIds(part.result);
        const callId = part.toolCallId ?? `task-${i}`;
        // Batch children use <tool call>:<one-based index> on the wire.
        const matchedRuns = liveDelegations.filter(
          (run) =>
            run.callId === callId ||
            (run.callId.startsWith(`${callId}:`) &&
              /^\d+$/.test(run.callId.slice(callId.length + 1))),
        );
        const agentIds = [
          ...new Set([
            ...resultAgentIds,
            ...matchedRuns.map((run) => run.agentId),
          ]),
        ];
        for (const agentId of agentIds.length ? agentIds : [callId]) {
          const exactRun = matchedRuns.find((run) => run.agentId === agentId);
          // Legacy inline messages lack canonical call identity. Only join an
          // unambiguous child once; a continuation must not rewrite history.
          const legacyRun =
            callId.startsWith("inline:") && occurrences.get(agentId) === 1
              ? runsByAgentId.get(agentId)
              : undefined;
          const run = exactRun ?? legacyRun;
          if (run) consumedRuns.add(run);
          items.push({
            kind: "agent",
            agentId,
            run,
            tool: part,
            order: agentOrder++,
            key: invocationKey(run?.callId ?? callId, agentId),
          });
        }
        return;
      }

      items.push({
        kind: "tool",
        tool: part,
        key: part.toolCallId ?? `tool-${i}`,
      });
      return;
    }

    if (part.text.trim().length === 0) return;
    const prev = items[items.length - 1];
    if (prev?.kind === "note") prev.text += `\n\n${part.text}`;
    else items.push({ kind: "note", text: part.text, key: `note-${i}` });
  });

  for (const run of liveDelegations) {
    if (consumedRuns.has(run)) continue;
    items.push({
      kind: "agent",
      agentId: run.agentId,
      run,
      order: agentOrder++,
      key: invocationKey(run.callId, run.agentId),
    });
  }

  return items;
};

/**
 * Drop-in replacement for `<MessagePrimitive.Parts>` in an assistant message.
 *
 * A merged turn is one ordered `content` array: interstitial talk (`text`) and
 * tool calls, then the final answer (`text`). We split at the LAST tool call —
 * everything up to and including it is the Working trace (tool steps + muted
 * interstitial notes, in order); the trailing `text` run is the final answer,
 * buffered out of view until the turn finishes so only it streams out below.
 * A plain reply with no tool calls remains buffered while running, then renders
 * directly once it is known to be the final answer.
 *
 * Delegations are the one row that does not come from the transcript alone: a
 * running child has no `task` part yet, so its row is rendered synthetically
 * from the `taskRuns` sidecar and hands over to the transcript part (same key,
 * same row) once that lands. See `WorkingAgent`.
 */
export const AssistantTurnParts: FC = () => {
  const content = useMessage((s) => s.content);
  const running = useMessage((s) => s.status?.type === "running");
  const isLast = useMessage((s) => s.isLast);
  const runtime = useOptionalAomiRuntime();
  const taskRuns = useThreadTaskRuns("turn");
  // Only animate a turn observed live in this component. Completed messages
  // restored from history render immediately instead of replaying the effect.
  const witnessedRunning = useRef(running);
  if (running) witnessedRunning.current = true;

  const lastToolIndex = content.reduce(
    (last, part, i) => (part.type === "tool-call" ? i : last),
    -1,
  );

  // The activity rail projects the whole thread, while a message trace only
  // consumes the current turn's sidecar. History renders from its transcript.
  const liveDelegations = isLast
    ? Object.values(taskRuns).sort((a, b) => a.startedAt - b.startedAt)
    : [];

  // Where the trace ends and the final answer begins. Normally the last tool
  // call — but a delegation that has not landed in the transcript yet has no
  // tool part at all, so a turn that is *only* a live delegation still gets a
  // trace (its talk becomes notes; the answer is buffered while running).
  const traceEnd =
    lastToolIndex >= 0
      ? lastToolIndex + 1
      : liveDelegations.length > 0
        ? content.length
        : 0;

  const answerText = collectText(
    content
      .slice(traceEnd)
      .filter((part): part is TextMessagePart => part.type === "text"),
  );

  const traceContent = content
    .slice(0, traceEnd)
    .filter(
      (part): part is TextMessagePart | ToolCallMessagePart =>
        part.type === "text" || part.type === "tool-call",
    );
  const items = buildTraceItems(traceContent, liveDelegations);

  // Awaiting an approval is a pause in the same turn, not completion. Keep the
  // trace visibly live until a real final answer exists and can begin its
  // synthetic stream. This also covers the short resume gap after approve or
  // reject, when polling has restarted but the next model event has not landed.
  const terminal =
    runtime?.turnState === "complete" ||
    runtime?.turnState === "interrupted" ||
    runtime?.turnState === "failed";
  const awaitingContinuation =
    !terminal &&
    isLast &&
    items.length > 0 &&
    (runtime?.turnState === "awaiting_action" ||
      runtime?.turnState === "processing" ||
      (witnessedRunning.current && answerText.length === 0));
  const traceLive = !terminal && (running || awaitingContinuation);
  const outcome: WorkingTraceOutcome = traceLive
    ? "running"
    : isLast && runtime?.turnState === "failed"
      ? "failed"
      : isLast && runtime?.turnState === "interrupted"
        ? "interrupted"
        : "complete";
  // A durable backend notice is projected as the following assistant message,
  // making this turn no longer last. While none exists, keep a failed turn from
  // ending in partial prose (or a tool trace) with no explanation.
  const showFailureFallback = outcome === "failed";

  // Transcript state is never delayed behind presentation. Rows enter the DOM
  // immediately; their bounded CSS entrance and chip cascade provide motion
  // without falling behind the activity rail during a batch.
  const revealed = items.length;

  // When the work actually began, for the header's "Orchestrated for Ns".
  // Anchored to the earliest signal we have: the moment this turn was first
  // seen running, or the earliest delegation's client-clock start — whichever
  // is older. Mount time alone lies when the trace mounts late (a delegating
  // turn's transcript part only lands at the very end).
  const turnStartRef = useRef<number | null>(running ? Date.now() : null);
  if (running && turnStartRef.current === null) {
    turnStartRef.current = Date.now();
  }
  const earliestRunStart = items.reduce<number | null>(
    (earliest, item) =>
      item.kind === "agent" && item.run
        ? Math.min(earliest ?? item.run.startedAt, item.run.startedAt)
        : earliest,
    null,
  );
  const startedAtMs =
    turnStartRef.current !== null && earliestRunStart !== null
      ? Math.min(turnStartRef.current, earliestRunStart)
      : (turnStartRef.current ?? earliestRunStart ?? undefined);

  if (items.length === 0) {
    // Before the first tool call, text is provisional: a later tool can move it
    // into the Working trace. Keep it buffered until the turn settles.
    if (running) {
      return runtime?.turnState === "processing" ? (
        <MinimalWorkingTrace />
      ) : null;
    }

    return answerText.length > 0 || showFailureFallback ? (
      <>
        {answerText.length > 0 && (
          <ProgressiveRenderedText
            text={answerText}
            animate={witnessedRunning.current}
          />
        )}
        {showFailureFallback && <TurnFailureFallback />}
      </>
    ) : null;
  }

  // Every trace item is already mounted, so presentation never gates the answer.
  const answerReady = !traceLive && revealed >= items.length;

  return (
    <>
      <WorkingTrace
        running={traceLive}
        outcome={outcome}
        items={items}
        revealed={revealed}
        collapseReady={answerText.length > 0}
        startedAtMs={startedAtMs}
      />
      {answerReady && answerText.length > 0 && (
        <div className="aui-working-answer">
          <ProgressiveRenderedText
            text={answerText}
            animate={witnessedRunning.current}
          />
        </div>
      )}
      {answerReady && showFailureFallback && <TurnFailureFallback />}
    </>
  );
};

const TurnFailureFallback: FC = () => (
  <p className="text-aomi-danger mt-2 text-sm leading-5" role="status">
    This run stopped before it could finish.
  </p>
);
