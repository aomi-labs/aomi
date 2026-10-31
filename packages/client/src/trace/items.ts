import type {
  Event,
  MessageEvent,
  ToolCompleteEvent,
  ToolUpdateEvent,
} from "../agent/types";
import {
  CONTEXT_STEP_TOOL,
  contextKey,
  contextPart,
  type ContextStep,
} from "./context";
import { isReadOutputTool, readOutputId } from "./read-output";
import type {
  TracePart,
  TraceRun,
  TraceTextPart,
  TraceToolPart,
} from "./types";

/**
 * One rendered row of the trace: a tool step, a run of interstitial talk, or a
 * delegated agent (whose own steps hang off it).
 */
export type TraceItem<
  T extends TraceToolPart = TraceToolPart,
  R extends TraceRun = TraceRun,
> =
  | { kind: "tool"; tool: T; key: string }
  | { kind: "note"; text: string; key: string }
  | { kind: "context"; step: ContextStep; key: string }
  | {
      kind: "read";
      /** Saved-output id every read in this run pages through. */
      id?: string;
      parts: T[];
      /** The tool whose output was shortened, when its trim is in this turn. */
      sourceTool?: string;
      key: string;
    }
  | {
      kind: "agent";
      agentId: string;
      /** Present once the mother's `task` part has landed in the transcript. */
      tool?: T;
      /** Present while the live sidecar knows about the run. */
      run?: R;
      /** Appearance order within the turn — picks the row's identity color. */
      order: number;
      key: string;
    };

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

/**
 * Reconcile the ordered transcript with the live delegation sidecar.
 *
 * A task exists in the sidecar before its transcript tool part arrives. Once
 * that part does arrive, it replaces the synthetic row at the transcript's
 * chronological position instead of being appended again at the bottom. This
 * matters when a failed child is followed by successful parent work: the
 * failure remains useful history without looking like the final active step.
 */
export const buildTraceItems = <
  T extends TraceToolPart = TraceToolPart,
  R extends TraceRun = TraceRun,
>(
  content: readonly (TraceTextPart | T)[],
  liveDelegations: readonly R[],
): TraceItem<T, R>[] => {
  const items: TraceItem<T, R>[] = [];
  const runsByAgentId = new Map(
    liveDelegations.map((run) => [run.agentId, run] as const),
  );
  const taskParts = content.filter(
    (part): part is T => part.type === "tool-call" && part.toolName === "task",
  );
  const occurrences = new Map<string, number>();
  for (const part of taskParts) {
    for (const agentId of taskResultAgentIds(part.result)) {
      occurrences.set(agentId, (occurrences.get(agentId) ?? 0) + 1);
    }
  }
  const consumedRuns = new Set<R>();
  const invocationKey = (callId: string, agentId: string) =>
    `agent-${JSON.stringify([callId, agentId])}`;
  let agentOrder = 0;
  // Saved-output id -> the tool that produced it, from this turn's trims.
  const trimmedSources = new Map<string, string>();

  content.forEach((part, i) => {
    if (part.type === "tool-call") {
      if (part.toolName === CONTEXT_STEP_TOOL) {
        const step = part.args as unknown as ContextStep;
        // Shortening a large output is bookkeeping, not a step: the reads
        // that page it back in carry the source tool's name instead.
        if (step.kind === "trimmed") {
          if (step.id) trimmedSources.set(step.id, step.tool);
          return;
        }
        items.push({
          kind: "context",
          step,
          key: part.toolCallId ?? `context-${i}`,
        });
        return;
      }
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

      if (isReadOutputTool(part.toolName)) {
        const id = readOutputId(part);
        const prev = items[items.length - 1];
        // Paging one output is one step. A read still streaming its args most
        // likely continues the run before it; a finished one without an id
        // stands alone.
        const streaming = id === undefined && part.result === undefined;
        if (prev?.kind === "read" && (streaming || (id && id === prev.id))) {
          prev.parts.push(part);
          prev.id ??= id;
          prev.sourceTool ??= id ? trimmedSources.get(id) : undefined;
        } else {
          items.push({
            kind: "read",
            id,
            parts: [part],
            sourceTool: id ? trimmedSources.get(id) : undefined,
            key: part.toolCallId ?? `read-${i}`,
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

const toolPart = (
  event: ToolUpdateEvent | ToolCompleteEvent,
): TraceToolPart => ({
  type: "tool-call",
  toolCallId: event.call_id ?? event.id,
  toolName: event.tool_name,
  args: undefined,
  result: event.result,
});

/**
 * The backend's event ledger bridges INLINE (sync-executed) tool steps as agent
 * `message` events carrying a `[topic, payload]` tuple in `tool_result`
 * (declared on the client's MessageEvent shape). These transcript results can
 * coexist with typed tool_update/tool_complete progress, including a later
 * wallet callback updating the originating call. Keep both wire paths and
 * reconcile them by call identity.
 */
const inlineToolResult = (event: MessageEvent) => {
  // Declared on the type, but the wire is untrusted — validate before use.
  const raw: unknown = event.tool_result;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const [topic, payload] = raw;
  if (typeof topic !== "string" || typeof payload !== "string") return null;
  return {
    topic,
    payload,
    toolName:
      typeof event.tool_name === "string" && event.tool_name.length > 0
        ? event.tool_name
        : topic,
    args: event.tool_arguments,
  };
};

const inlineToolPart = (
  tool: NonNullable<ReturnType<typeof inlineToolResult>>,
  key: string,
  toolCallId?: string | null,
): TraceToolPart => {
  let result: unknown = tool.payload;
  try {
    result = JSON.parse(tool.payload);
  } catch {
    // Non-JSON payloads render verbatim.
  }
  return {
    type: "tool-call",
    toolCallId: toolCallId ?? `inline:${key}`,
    toolName: tool.toolName,
    args: tool.args,
    result,
  };
};

/**
 * The part one event adds to its turn, under the key a re-delivery of the same
 * part reuses. Agent prose and tool calls are keyed separately.
 */
export const tracePart = (
  event: Event,
): { key: string; part: TracePart } | null => {
  if (event.type === "message") {
    if (event.sender !== "agent") return null;
    const key = event.message_key ?? event.event_id;
    const tool = inlineToolResult(event);
    return tool
      ? {
          key: event.tool_call_id ?? `inline:${key}`,
          part: inlineToolPart(tool, key, event.tool_call_id),
        }
      : { key, part: { type: "text", text: event.content } };
  }
  if (
    event.type === "context_compacting" ||
    event.type === "context_compacted" ||
    event.type === "tool_output_trimmed"
  )
    return { key: contextKey(event), part: contextPart(event) };
  if (
    (event.type === "tool_update" || event.type === "tool_complete") &&
    event.tool_name !== "task"
  )
    return { key: event.call_id ?? event.id, part: toolPart(event) };
  return null;
};

/** A re-delivered tool part keeps the arguments an earlier delivery carried. */
export const mergeTracePart = (
  previous: TracePart | undefined,
  part: TracePart,
): TracePart =>
  previous?.type === "tool-call" && part.type === "tool-call"
    ? { ...previous, ...part, args: part.args ?? previous.args }
    : part;

/** One turn's events as trace rows, joined with its live delegated runs. */
export const traceFromEvents = <R extends TraceRun = TraceRun>(
  events: readonly Event[],
  runs: readonly R[] = [],
): TraceItem<TraceToolPart, R>[] => {
  const parts: TracePart[] = [];
  const at = new Map<string, number>();
  for (const event of events) {
    const entry = tracePart(event);
    if (!entry) continue;
    const key = `${entry.part.type}:${entry.key}`;
    const index = at.get(key);
    if (index === undefined) {
      at.set(key, parts.length);
      parts.push(entry.part);
    } else parts[index] = mergeTracePart(parts[index], entry.part);
  }
  return buildTraceItems(parts, runs);
};
