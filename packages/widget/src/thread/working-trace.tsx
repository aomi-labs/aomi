"use client";

import { cn } from "@/lib/cn";
import {
  type FC,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  TextMessagePartProvider,
  useMessage,
  type TextMessagePart,
  type ToolCallMessagePart,
} from "@assistant-ui/react";
import { ChevronRightIcon } from "lucide-react";

import {
  useChatViewFlag,
  useChatView,
  useOptionalAomiRuntime,
  useThreadTaskRuns,
  walletContinuationPending,
  type TaskRunState,
} from "@aomi-labs/react";
import type { Event, TurnState } from "@aomi-labs/client";
import {
  buildTraceItems,
  type TraceItem as TraceRow,
} from "@aomi-labs/client/trace";
import { MarkdownText } from "./markdown-text";
import { testIds } from "@/test-ids";
import { TraceBurst } from "./trace-burst";
import { Fold, Swap, useFlip } from "./trace-motion";
import { holdStill } from "./use-follow";
import { agentStepCount } from "./working-agent";
import { isWorkLimitPause } from "./notice-codes";

/** Interstitial prose and tool progress share one chronological trace. */

const formatDuration = (seconds: number): string => {
  const totalSeconds = Math.max(1, Math.round(seconds));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s}s`;
};

const phaseTimeMs = (value: string | number | undefined): number => {
  if (typeof value === "number") return value < 1e12 ? value * 1_000 : value;
  if (typeof value !== "string") return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? numeric < 1e12
      ? numeric * 1_000
      : numeric
    : Date.parse(value);
};

/** Sum persisted processing intervals; awaiting wallet approval pauses time. */
export function activeWorkDurationMs(
  events: readonly Event[],
  turnIds: readonly string[],
  nowMs: number,
  /** Clip to one segment of a turn a follow-up split. */
  bounds: { start?: number; end?: number } = {},
): number | null {
  const ids = new Set(turnIds);
  const started = new Map<string, number>();
  let total = 0;
  let observed = false;
  const span = (from: number, to: number) =>
    Math.max(
      0,
      Math.min(to, bounds.end ?? to) - Math.max(from, bounds.start ?? from),
    );
  for (const event of events) {
    if (
      event.type !== "turn_state_changed" ||
      !event.turn_id ||
      !ids.has(event.turn_id)
    )
      continue;
    const at = phaseTimeMs(event.occurred_at);
    if (!Number.isFinite(at) || at <= 0) continue;
    if (event.state === "processing") {
      observed = true;
      if (!started.has(event.turn_id)) started.set(event.turn_id, at);
    } else {
      const from = started.get(event.turn_id);
      if (from !== undefined) total += span(from, at);
      started.delete(event.turn_id);
    }
  }
  for (const from of started.values()) total += span(from, nowMs);
  return observed ? total : null;
}

/** One rendered row of the trace, over this transcript's parts and runs. */
type TraceItem = TraceRow<ToolCallMessagePart, TaskRunState>;

// Published from ./components/assistant-ui/working-trace before the decoder moved.
export { buildTraceItems };

/** Child steps an agent row contributes to the header step count. */
const childStepCount = (item: TraceItem): number =>
  item.kind === "agent" ? agentStepCount(item.run) : 0;

/** No news for this long and the header says so. */
const QUIET_MS = 8_000;

type Segment =
  | { kind: "text"; key: string; text: string }
  | { kind: "burst"; key: string; items: TraceItem[]; earlier: unknown[] };

/** The story of a turn: the agent's words, and the calls between them. */
function toSegments(items: readonly TraceItem[]): Segment[] {
  const segments: Segment[] = [];
  const results: unknown[] = [];
  for (const item of items) {
    const last = segments.at(-1);
    if (item.kind === "note")
      segments.push({ kind: "text", key: item.key, text: item.text });
    else if (last?.kind === "burst") last.items.push(item);
    else
      segments.push({
        kind: "burst",
        key: item.key,
        items: [item],
        earlier: [...results],
      });
    if (item.kind === "tool") results.push(item.tool.result);
  }
  return segments;
}

type WorkingTraceOutcome = "running" | "complete" | "failed" | "interrupted";

export const WorkingTrace: FC<{
  viewKey?: string;
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
  phaseEvents?: readonly Event[];
  phaseTurnIds?: readonly string[];
  phaseBounds?: { start?: number; end?: number };
  /** The turn stopped at its work limit and can be continued. */
  paused?: boolean;
  /** The turn paused for the reader's signature; the work is not over. */
  waiting?: boolean;
  /** The message is still on its way; nothing counts yet. */
  sending?: boolean;
  /** A reply without any steps: the row closes and the answer moves up. */
  leaving?: boolean;
}> = ({
  viewKey = "trace",
  running: live,
  outcome: turnOutcome = live ? "running" : "complete",
  items,
  revealed,
  collapseReady = true,
  startedAtMs,
  phaseEvents,
  phaseTurnIds,
  phaseBounds,
  paused = false,
  waiting = false,
  sending = false,
  leaving = false,
}) => {
  // A signature request is part of the work, like a question in a coding
  // harness: the trace stays open and closes when the last turn ends.
  const running = live;
  const outcome = turnOutcome;
  const [open, setOpen] = useChatViewFlag(`${viewKey}:open`, running);
  const header = useFlip<HTMLButtonElement>();
  const touched = useRef(false);
  const touchedKey = useRef(viewKey);
  if (touchedKey.current !== viewKey) {
    touchedKey.current = viewKey;
    touched.current = false;
  }
  const observedLiveWork = useRef(running);
  if (running) observedLiveWork.current = true;
  const [elapsed, setElapsed] = useState<number | null>(null);
  const wasRunning = useRef(running);
  const startedAt = useRef<number>(startedAtMs ?? Date.now());
  const [clockMs, setClockMs] = useState(Date.now);
  // An earlier anchor can arrive after mount (e.g. the first task_started
  // event lands a beat later); only ever move the start backwards.
  if (startedAtMs !== undefined && startedAtMs < startedAt.current) {
    startedAt.current = startedAtMs;
  }

  useEffect(() => {
    if (!running) return;
    const update = () => setClockMs(Date.now());
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [running, startedAtMs]);

  // The open interval is server-stamped but measured against this clock. Read
  // the offset off the newest event as it lands (delivery lag is seconds); a
  // skewed server clock would otherwise inflate the live count by the skew.
  const latestEventMs = (phaseEvents ?? []).reduce(
    (latest, event) => Math.max(latest, phaseTimeMs(event.occurred_at) || 0),
    0,
  );
  const clockSkewMs = useMemo(() => {
    const skew = Date.now() - latestEventMs;
    return latestEventMs > 0 && Math.abs(skew) > 60_000 ? skew : 0;
  }, [latestEventMs]);
  const persistedActiveMs =
    phaseEvents && phaseTurnIds
      ? activeWorkDurationMs(
          phaseEvents,
          phaseTurnIds,
          clockMs - clockSkewMs,
          phaseBounds,
        )
      : null;
  const runningSeconds = Math.max(
    0,
    Math.floor((persistedActiveMs ?? clockMs - startedAt.current) / 1_000),
  );

  const visibleItems = useMemo(
    () => items.slice(0, revealed),
    [items, revealed],
  );
  const segments = useMemo(() => toSegments(visibleItems), [visibleItems]);

  // Anything new, a step or more text, counts as news.
  const news = visibleItems.reduce(
    (total, item) =>
      total +
      (item.kind === "note"
        ? item.text.length
        : 1_000 +
          childStepCount(item) +
          (item.kind === "tool" && item.tool.result !== undefined ? 1 : 0)),
    0,
  );
  const lastNews = useRef({ news: -1, at: Date.now() });
  if (lastNews.current.news !== news)
    lastNews.current = { news, at: Date.now() };
  const quiet =
    running &&
    !leaving &&
    !waiting &&
    clockMs - lastNews.current.at >= QUIET_MS;

  // The trace has fully caught up once every queued item has been revealed.
  const fullyRevealed = !running && revealed >= items.length;

  useEffect(() => {
    if (wasRunning.current && !running) {
      // turn just finished: freeze the timer (collapse waits for full reveal)
      setElapsed((Date.now() - startedAt.current) / 1000);
    }
    // The work goes on after a signature, so its steps are in view again.
    if (!wasRunning.current && running) setOpen(true);
    wasRunning.current = running;
  }, [running, setOpen]);

  // A delegating turn's `task` part only lands once its children have finished,
  // so this trace can mount already-complete and never observe the transition
  // above — leaving it with no duration at all. Its children carry real
  // client-clock spans; report those instead of dropping the label. Never
  // `Date.now()` here: that would grow with the age of reloaded history rather
  // than measure the run.
  const delegatedSpanMs = items.reduce<number | undefined>((span, item) => {
    const run = item.kind === "agent" ? item.run : undefined;
    if (!run || run.startedAt <= 0 || run.durationMs == null) return span;
    const end = run.startedAt + run.durationMs - startedAt.current;
    return Math.max(span ?? 0, end);
  }, undefined);
  useEffect(() => {
    if (running || elapsed !== null || delegatedSpanMs === undefined) return;
    setElapsed(Math.max(0, delegatedSpanMs) / 1000);
  }, [running, elapsed, delegatedSpanMs]);

  // Fold once the answer stands on its own. Work that
  // failed or was stopped stays open, and a trace restored on a chat revisit
  // keeps the reader's choice.
  useEffect(() => {
    if (
      !observedLiveWork.current ||
      !fullyRevealed ||
      outcome !== "complete" ||
      !collapseReady ||
      // What the reader opened during the turn stays open.
      touched.current
    )
      return;
    const timer = setTimeout(() => {
      if (touched.current) return;
      holdStill(header.current, 800);
      setOpen(false);
    }, 700);
    return () => clearTimeout(timer);
  }, [collapseReady, fullyRevealed, outcome, setOpen]);

  const completedSeconds =
    persistedActiveMs === null ? elapsed : persistedActiveMs / 1_000;
  const duration =
    completedSeconds != null ? formatDuration(completedSeconds) : undefined;
  const doneLabel =
    outcome === "failed"
      ? "Failed"
      : outcome === "interrupted"
        ? paused
          ? "Paused"
          : "Stopped"
        : undefined;

  // Step count rule: every shown call counts as one step, and a delegated agent
  // row additionally contributes its child steps (its reported `stepCount`, or
  // the steps actually observed).
  const stepCount = visibleItems.reduce(
    (total, item) =>
      total + (item.kind === "note" ? 0 : 1 + childStepCount(item)),
    0,
  );
  const foldable = segments.length > 0;

  return (
    <div
      data-testid={testIds.trace}
      aria-hidden={leaving || undefined}
      inert={leaving}
      className={cn(
        // A plain reply starts level with the logo, 2.5 px down.
        "aui-working-trace grid min-h-[2.5px] w-full grid-cols-[minmax(0,1fr)] motion-reduce:!transition-none",
        leaving ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
      )}
      style={{
        transition:
          "grid-template-rows 520ms cubic-bezier(.4,0,.1,1) 120ms, opacity 260ms ease",
      }}
    >
      <div className={cn("min-h-0", leaving && "overflow-hidden")}>
        <div className="pb-3">
          <button
            ref={header}
            type="button"
            disabled={!foldable}
            onClick={() => {
              touched.current = true;
              setOpen((value) => !value);
            }}
            aria-expanded={foldable ? open : undefined}
            className={cn(
              "aui-working-trace-header animate-in fade-in group/head bg-aomi-bg relative flex min-h-7 items-center gap-2.5 text-left text-sm leading-5 duration-500 motion-reduce:animate-none",
              running || leaving
                ? // The padding covers steps scrolling under it; the text stays where
                  // the finished header has it.
                  "sticky -top-2 z-[5] -mb-1 -mt-2 min-h-10 w-full pb-1 pt-2 shadow-[0_6px_6px_-2px_var(--aomi-bg)]"
                : "focus-visible:outline-aomi-accent rounded-control w-fit outline-offset-[3px] focus-visible:outline-2",
            )}
          >
            {(running || leaving) && (
              // Sending: a dot where the word will be. Both stay mounted, so one
              // becomes the other without anything moving.
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute left-0 flex size-2.5 transition-[opacity,scale] duration-300 ease-out motion-reduce:transition-none",
                  sending ? "scale-100 opacity-100" : "scale-[.3] opacity-0",
                )}
              >
                <span className="bg-aomi-fg size-2.5 animate-pulse rounded-full motion-reduce:animate-none" />
              </span>
            )}
            <span
              className={cn(
                "block min-w-0 shrink-0 transition-[opacity,translate] duration-[420ms] ease-[cubic-bezier(.22,.8,.26,1)] motion-reduce:transition-none",
                sending
                  ? "-translate-x-1 opacity-0"
                  : "translate-x-0 opacity-100 delay-100",
              )}
            >
              <Swap
                id={leaving ? "running" : waiting ? "waiting" : outcome}
                className="shrink-0"
              >
                {waiting && !leaving ? (
                  <span
                    role="status"
                    className="aui-working-waiting text-aomi-fg inline-flex items-center gap-2 font-medium"
                  >
                    <span
                      aria-hidden
                      className="bg-aomi-warning size-1.5 animate-pulse rounded-full motion-reduce:animate-none"
                    />
                    Waiting for your signature
                  </span>
                ) : leaving || outcome === "running" ? (
                  <span className="aui-working-shimmer font-medium">
                    Working
                  </span>
                ) : (
                  <span className="text-aomi-muted group-hover/head:text-aomi-fg transition-colors">
                    {doneLabel ?? (duration ? "Worked for" : "Worked it out")}
                    {duration && (
                      <>
                        {doneLabel ? " after " : " "}
                        <span className="text-aomi-fg font-medium">
                          {duration}
                        </span>
                      </>
                    )}
                  </span>
                )}
              </Swap>
            </span>
            {(running || leaving) && !sending && (
              <span
                data-flip="time"
                aria-label="Working time"
                className="text-aomi-muted text-[13px] tabular-nums"
              >
                {runningSeconds === 0 ? "0s" : formatDuration(runningSeconds)}
              </span>
            )}
            {quiet && (
              <span data-flip="quiet" className="text-aomi-muted text-[13px]">
                taking a bit longer
              </span>
            )}
            {!running && !leaving && stepCount > 0 && (
              <span
                data-flip="steps"
                className="text-aomi-muted text-[13px] tabular-nums"
              >
                {stepCount} {stepCount === 1 ? "step" : "steps"}
              </span>
            )}
            {foldable && !sending && (
              <span data-flip="arrow">
                <ChevronRightIcon
                  className={cn(
                    "text-aomi-muted group-hover/head:text-aomi-fg size-3 opacity-75 transition-[rotate,opacity,color] duration-300 group-hover/head:opacity-100",
                    open && "rotate-90",
                  )}
                />
              </span>
            )}
          </button>

          {foldable && (
            <Fold open={open} slow>
              <div
                className={cn(
                  "flex flex-col gap-3",
                  // Two 28 px rows in a row carry their own air.
                  segments[0]?.kind === "burst" ? "pt-2" : "pt-3",
                )}
              >
                {segments.map((segment, index) =>
                  segment.kind === "text" ? (
                    <div key={segment.key} className="aui-working-note">
                      <RenderedText text={segment.text} />
                    </div>
                  ) : (
                    <TraceBurst
                      key={segment.key}
                      viewKey={`${viewKey}:${segment.key}`}
                      items={segment.items}
                      earlier={segment.earlier}
                      live={running && index === segments.length - 1}
                      animate={running}
                      onTouch={() => {
                        touched.current = true;
                      }}
                    />
                  ),
                )}
              </div>
            </Fold>
          )}
        </div>
      </div>
    </div>
  );
};

/** Before the first words or steps: the same header, already counting. */
export const MinimalWorkingTrace: FC<{ startedAtMs?: number }> = ({
  startedAtMs,
}) => (
  <div role="status" aria-label="Aomi is working">
    <WorkingTrace
      viewKey="start"
      running
      items={[]}
      revealed={0}
      startedAtMs={startedAtMs}
    />
  </div>
);

export const RenderedText: FC<{ text: string }> = memo(function RenderedText({
  text,
}: {
  text: string;
}) {
  const threadId = useChatView()?.threadId;
  const recorded = useRef(false);
  useLayoutEffect(() => {
    if (!recorded.current && text.trim()) {
      recorded.current = true;
      // DOM commit marker, not a claim about compositor paint or answer quality.
      performance.mark?.("aomi:answer-committed", {
        detail: { sessionId: threadId },
      });
    }
  }, [text, threadId]);
  return (
    <TextMessagePartProvider text={text}>
      <MarkdownText />
    </TextMessagePartProvider>
  );
});

/** Keep working notes with their tools; only the final answer sits outside. */
export const AssistantTurnParts: FC<{ sending?: boolean }> = ({
  sending = false,
}) => {
  const messageId = useMessage((s) => s.id);
  // A follow-up splits a turn: the work above it is a closed segment.
  const segment = useMessage(
    (s) =>
      s.metadata?.custom as
        | {
            aomiTurnId?: string;
            aomiTraceStartedAt?: number;
            aomiTraceClosedAt?: number;
          }
        | undefined,
  );
  const closed = segment?.aomiTraceClosedAt !== undefined;
  const pausedAtWorkLimit = useMessage((s) =>
    isWorkLimitPause(
      (s.metadata?.custom as { aomiNoticeCode?: string } | undefined)
        ?.aomiNoticeCode,
    ),
  );
  const content = useMessage((s) => s.content);
  const finalAnswerStartIndex = useMessage(
    (s) =>
      (s.metadata?.custom as { aomiFinalAnswerStartIndex?: number } | undefined)
        ?.aomiFinalAnswerStartIndex,
  );
  const continuationTurnIds = useMessage(
    (s) =>
      (s.metadata?.custom as { aomiContinuationTurnIds?: string[] } | undefined)
        ?.aomiContinuationTurnIds,
  );
  const projectedContinuationStates = useMessage(
    (s) =>
      (
        s.metadata?.custom as
          | { aomiContinuationTurnStates?: Record<string, TurnState> }
          | undefined
      )?.aomiContinuationTurnStates,
  );
  const projectedTurnState = useMessage(
    (s) =>
      (s.metadata?.custom as { aomiTurnState?: TurnState } | undefined)
        ?.aomiTurnState,
  );
  const running = useMessage((s) => s.status?.type === "running");
  const isLast = useMessage((s) => s.isLast);
  const runtime = useOptionalAomiRuntime();
  const taskRuns = useThreadTaskRuns("turn");
  const turnId =
    segment?.aomiTurnId ??
    (messageId.startsWith("turn:")
      ? messageId.slice("turn:".length)
      : undefined);
  const turnEvents = runtime?.events ?? [];
  const ownState = turnId
    ? turnEvents.findLast(
        (event) =>
          event.type === "turn_state_changed" && event.turn_id === turnId,
      )
    : undefined;
  const stoppedContinuation = (continuationTurnIds ?? [])
    .map((turnId) => projectedContinuationStates?.[turnId])
    .findLast((state) => state === "failed" || state === "interrupted");
  const ownStatus =
    stoppedContinuation ??
    projectedTurnState ??
    (ownState?.type === "turn_state_changed" ? ownState.state : undefined);
  const ownTerminal =
    ownStatus !== undefined &&
    ["complete", "failed", "interrupted"].includes(ownStatus);
  const ownStopped = ownStatus === "failed" || ownStatus === "interrupted";
  const walletContinuation = walletContinuationPending(
    (continuationTurnIds ?? []).filter((turnId) => {
      const state = projectedContinuationStates?.[turnId];
      return !state || !["complete", "failed", "interrupted"].includes(state);
    }),
    turnEvents,
  );
  // A commit returns before wallet approval and the backend marks its model
  // turn complete. Keep this trace live through the durable commit and its
  // broadcast-terminal continuation. A later turn's processing state must not
  // reanimate an unrelated completed trace.
  const live =
    !closed &&
    !ownStopped &&
    (walletContinuation ||
      (isLast &&
        !ownTerminal &&
        (running ||
          ["processing", "awaiting_action"].includes(
            runtime?.turnState ?? "",
          ))));
  // The model turn ended and its transaction needs the reader: nothing runs
  // until a wallet callback starts.
  const callbackRunning = (continuationTurnIds ?? []).some((id) => {
    const state = turnEvents.findLast(
      (event) => event.type === "turn_state_changed" && event.turn_id === id,
    );
    return state?.type === "turn_state_changed" && state.state === "processing";
  });
  const waiting =
    live &&
    !callbackRunning &&
    (ownStatus === "awaiting_action" ||
      (walletContinuation && ownStatus === "complete"));
  const outcome: WorkingTraceOutcome = live
    ? "running"
    : closed
      ? "complete"
      : ownStatus === "failed" || (isLast && runtime?.turnState === "failed")
        ? "failed"
        : ownStatus === "interrupted" ||
            (isLast && runtime?.turnState === "interrupted")
          ? "interrupted"
          : "complete";
  const delegations = isLast
    ? Object.values(taskRuns).sort((a, b) => a.startedAt - b.startedAt)
    : [];
  // When the work actually began, for the header's "Worked for Ns". Anchored to
  // the earliest signal available: the moment this turn was first seen live, or
  // the earliest delegation's client-clock start — whichever is older. Mount
  // time alone lies when the trace mounts late, and a delegating turn's `task`
  // part only lands once its children have already finished.
  const firstSeenLive = useRef<number | undefined>(
    live ? Date.now() : undefined,
  );
  if (live && firstSeenLive.current === undefined) {
    firstSeenLive.current = Date.now();
  }
  const earliestDelegation = delegations.reduce<number | undefined>(
    (earliest, run) =>
      run.startedAt > 0
        ? Math.min(earliest ?? run.startedAt, run.startedAt)
        : earliest,
    undefined,
  );
  const startedAtMs =
    firstSeenLive.current !== undefined && earliestDelegation !== undefined
      ? Math.min(firstSeenLive.current, earliestDelegation)
      : (firstSeenLive.current ?? earliestDelegation);
  const parts = content.filter(
    (part): part is TextMessagePart | ToolCallMessagePart =>
      part.type === "text" || part.type === "tool-call",
  );
  const lastToolIndex = parts.findLastIndex(
    (part) => part.type === "tool-call",
  );
  const firstToolIndex = parts.findIndex((part) => part.type === "tool-call");
  const explicitAnswerBoundary =
    typeof finalAnswerStartIndex === "number" &&
    finalAnswerStartIndex >= 0 &&
    finalAnswerStartIndex <= parts.length;
  // A response key identifies which prose is the answer, not whether the
  // operation has finished. Parent completion precedes wallet callbacks, and
  // response text can arrive before the callback's durable complete event.
  // Waiting for a signature is not the end: text stays in the open trace
  // until the wallet callback's own answer.
  const answerReady =
    closed ||
    (!live &&
      !ownStopped &&
      (ownStatus === "complete" ||
        (ownStatus === undefined &&
          isLast &&
          runtime?.turnState === "complete")));
  const represented = new Set(
    parts
      .filter((part) => part.type === "tool-call")
      .map((part) => part.toolCallId),
  );
  const pending = delegations.filter(
    (run) => !run.callId || !represented.has(run.callId),
  );
  // Any live text, including the first part, may still precede a tool call.
  // Completion is the boundary that identifies the final answer; until then
  // keep prose in the trace rather than moving it back when a tool arrives.
  const traceEnd = !answerReady
    ? parts.length
    : explicitAnswerBoundary
      ? finalAnswerStartIndex
      : lastToolIndex + 1;
  // Only one message is the final answer. Earlier narration can follow the
  // last tool too; a transient tool-free interval is not an answer boundary.
  const finalTextIndex = answerReady
    ? explicitAnswerBoundary &&
      parts[finalAnswerStartIndex]?.type === "text" &&
      (parts[finalAnswerStartIndex] as TextMessagePart).text.trim()
      ? finalAnswerStartIndex
      : parts.findLastIndex(
          (part, index) =>
            index >= traceEnd &&
            part.type === "text" &&
            Boolean(part.text.trim()),
        )
    : -1;
  const answerIndexes = new Set(finalTextIndex >= 0 ? [finalTextIndex] : []);
  // A late tool completion or an empty final-answer marker can leave the
  // completed prose before the boundary. Keep the tool in the trace while
  // showing the last nonempty text as the answer instead of hiding it there.
  if (
    answerReady &&
    !live &&
    outcome === "complete" &&
    !ownStopped &&
    answerIndexes.size === 0 &&
    firstToolIndex >= 0
  ) {
    const lastTextIndex = parts.findLastIndex(
      (part) => part.type === "text" && part.text.trim().length > 0,
    );
    if (lastTextIndex > firstToolIndex) answerIndexes.add(lastTextIndex);
  }
  const traceItems = buildTraceItems<ToolCallMessagePart, TaskRunState>(
    parts.filter((part, index) => !answerIndexes.has(index)),
    delegations,
  );
  const answerParts = parts.filter(
    (part, index): part is TextMessagePart =>
      part.type === "text" && answerIndexes.has(index),
  );
  const hasTrace = traceItems.length > 0 || (live && pending.length === 0);
  // A plain reply had only the Working row: close it instead of dropping it.
  const lastLive = useRef<string | undefined>(undefined);
  if (live) lastLive.current = messageId;
  const leaving =
    !hasTrace && outcome === "complete" && lastLive.current === messageId;
  return (
    <>
      {(hasTrace || leaving) && (
        <WorkingTrace
          key="turn-trace"
          viewKey={messageId}
          running={live}
          outcome={
            pausedAtWorkLimit && outcome === "failed" ? "interrupted" : outcome
          }
          paused={pausedAtWorkLimit}
          items={traceItems}
          revealed={traceItems.length}
          collapseReady={!live}
          waiting={waiting}
          sending={sending}
          leaving={leaving}
          startedAtMs={startedAtMs}
          phaseEvents={turnEvents}
          phaseTurnIds={turnId ? [turnId, ...(continuationTurnIds ?? [])] : []}
          phaseBounds={{
            start: segment?.aomiTraceStartedAt,
            end: segment?.aomiTraceClosedAt,
          }}
        />
      )}
      {answerParts.map((part, index) =>
        part.text ? (
          <div
            className={cn(
              "aui-working-answer",
              // Level with the logo when nothing stands above it.
              !hasTrace && !leaving && index === 0 && "pt-[2.5px]",
            )}
            key={`answer:${index}`}
          >
            <RenderedText text={part.text} />
          </div>
        ) : null,
      )}
      {/* A work-limit pause has its own notice with Continue. */}
      {outcome === "failed" && !pausedAtWorkLimit && <TurnFailureFallback />}
    </>
  );
};

const TurnFailureFallback: FC = () => (
  <p className="text-aomi-danger mt-2 text-sm leading-5" role="status">
    This run failed before it could finish.
  </p>
);
