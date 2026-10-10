import type { ThreadMessageLike } from "@assistant-ui/react";

import {
  projectConversationEvents,
  type ContextCompactedEvent,
  type ContextCompactingEvent,
  type Event,
  type MessageEvent,
  type SessionSnapshot,
  type ToolCompleteEvent,
  type ToolOutputTrimmedEvent,
  type ToolUpdateEvent,
  type TurnState,
} from "@aomi-labs/client";

import {
  extractCapabilityHints,
  stripCapabilityHints,
} from "./capability-hints";
import { parseTimestamp } from "./timestamp";

type MessageContentPart =
  Exclude<ThreadMessageLike["content"], string> extends readonly (infer U)[]
    ? U
    : never;

const userMessageId = (ordinal: number) => `aomi-user-${ordinal}`;

function toInboundMessage(
  msg: MessageEvent,
  /** Position in the raw list, the id fallback for a notice with no key. */
  rawIndex = 0,
): ThreadMessageLike | null {
  // Internal system records are not client-visible chat turns.
  if (msg.sender === "system") {
    return null;
  }

  // A notice explains a turn that produced no answer. It rides the durable
  // message projection precisely so the explanation survives a reload — the
  // transient `system_error` event cannot, since the backend drains it.
  if (msg.sender === "notice") {
    return {
      id: noticeMessageId(msg, rawIndex),
      role: "assistant",
      content: [{ type: "text" as const, text: msg.content ?? "" }],
      createdAt: new Date(),
      metadata: {
        custom: {
          aomiNoticeKind: "error",
          aomiNoticeTitle: "Error",
        },
      },
    };
  }

  return buildInboundMessage(msg);
}

/**
 * Id for a projected notice.
 *
 * Prefers the backend's own `message_key`, which is unique per failure. Content
 * cannot serve here — every notice carries identical copy, so two failed turns
 * in one thread would render under the same id. The index fallback covers
 * rows with no key; it is still position-stable within a projection.
 */
function noticeMessageId(msg: MessageEvent, index: number): string {
  return `aomi-notice-${msg.message_key ?? `idx-${index}`}`;
}

function buildInboundMessage(msg: MessageEvent): ThreadMessageLike | null {
  const content: MessageContentPart[] = [];
  const role: ThreadMessageLike["role"] =
    msg.sender === "user" ? "user" : "assistant";

  const messageText =
    role === "user" ? stripCapabilityHints(msg.content ?? "") : msg.content;
  const capabilityHints =
    role === "user" ? extractCapabilityHints(msg.content ?? "") : [];
  if (messageText && messageText.trim().length > 0) {
    content.push({ type: "text" as const, text: messageText });
  }

  if (content.length === 0 && role === "assistant" && !msg.is_streaming) {
    return null;
  }

  const threadMessage = {
    // A stable id keeps assistant-ui from assigning positional ids that
    // shift (and re-key the row) when earlier projections change shape.
    id: msg.message_key ?? msg.event_id,
    role,
    content: content as ThreadMessageLike["content"],
    createdAt: new Date(parseTimestamp(msg.occurred_at)),
    ...(role === "user"
      ? {
          metadata: {
            custom: {
              ...(msg.message_key
                ? { aomiUserMessageKey: msg.message_key }
                : {}),
              ...(capabilityHints.length > 0
                ? { aomiCapabilityHints: capabilityHints }
                : {}),
            },
          },
        }
      : {}),
  } satisfies ThreadMessageLike;

  return threadMessage;
}

type AssistantProjection = {
  message: ThreadMessageLike & { id: string };
  parts: MessageContentPart[];
  textParts: Map<string, number>;
  toolParts: Map<string, number>;
  finalAnswerStartIndex?: number;
  responseMessageKey?: string;
};

/** Insert a part once per key, replacing it in place on re-delivery. */
const upsertPart = (
  projection: AssistantProjection,
  registry: Map<string, number>,
  key: string,
  part: MessageContentPart,
) => {
  const index = registry.get(key);
  if (index === undefined) {
    registry.set(key, projection.parts.length);
    projection.parts.push(part);
  } else {
    const previous = projection.parts[index];
    projection.parts[index] =
      previous?.type === "tool-call" && part.type === "tool-call"
        ? { ...previous, ...part, args: part.args ?? previous.args }
        : part;
  }
};

/**
 * Reserved part name for context steps (#1240): earlier conversation
 * summarized, or a large tool output shortened. They ride the turn's content
 * as tool-call parts so they keep their place in the working trace; no real
 * tool can have this name.
 */
export const CONTEXT_STEP_TOOL = "aomi:context";

export type ContextStep =
  | { kind: "compacting"; tokensBefore: number }
  | {
      kind: "compacted";
      published: boolean;
      tokensBefore: number;
      tokensAfter: number;
      durationMs: number;
    }
  | { kind: "trimmed"; tool: string; bytes: number; tokens: number };

type ContextEvent =
  | ContextCompactingEvent
  | ContextCompactedEvent
  | ToolOutputTrimmedEvent;

/** A compaction's start and end share one part, so the live row finishes in place. */
const contextKey = (event: ContextEvent): string =>
  event.type === "tool_output_trimmed"
    ? `context:${event.event_id}`
    : `context:compaction:${event.id}`;

const contextStep = (event: ContextEvent): ContextStep => {
  switch (event.type) {
    case "context_compacting":
      return { kind: "compacting", tokensBefore: event.tokens_before };
    case "context_compacted":
      return {
        kind: "compacted",
        published: event.published,
        tokensBefore: event.tokens_before,
        tokensAfter: event.tokens_after,
        durationMs: event.duration_ms,
      };
    case "tool_output_trimmed":
      return {
        kind: "trimmed",
        tool: event.tool,
        bytes: event.bytes,
        tokens: event.tokens,
      };
  }
};

const contextPart = (event: ContextEvent): MessageContentPart => {
  const step = contextStep(event);
  return {
    type: "tool-call",
    toolCallId: contextKey(event),
    toolName: CONTEXT_STEP_TOOL,
    args: step,
    result: step,
  } as MessageContentPart;
};

const toolPart = (
  event: ToolUpdateEvent | ToolCompleteEvent,
): MessageContentPart =>
  ({
    type: "tool-call",
    toolCallId: event.call_id ?? event.id,
    toolName: event.tool_name,
    args: undefined,
    result: event.result,
  }) as MessageContentPart;

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
): MessageContentPart => {
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
  } as MessageContentPart;
};

/** A durable commit resumes under a new backend turn id after wallet action. */
function commitContinuationOwners(
  events: readonly Event[],
): Map<string, string> {
  const owners = new Map<string, string>();
  for (const event of events) {
    if (!event.turn_id) continue;
    const toolName =
      (event.type === "message" || event.type === "tool_complete") &&
      event.tool_name?.split("::").at(-1);
    const isCommit = /^(evm|svm)_commit_(txs|tx|ix|message)$/.test(
      toolName || "",
    );
    const isInlineCommit =
      event.type === "message" && event.sender === "agent" && isCommit;
    const isTypedCommit = event.type === "tool_complete" && isCommit;
    if (!isInlineCommit && !isTypedCommit) continue;
    try {
      const raw = isInlineCommit
        ? JSON.parse((event as MessageEvent).tool_result?.[1] ?? "null")
        : (event as ToolCompleteEvent).result;
      if (!raw || typeof raw !== "object") continue;
      const result = raw as {
        commits?: unknown;
        commit_id?: unknown;
        batch?: { batch_id?: unknown };
        status?: unknown;
      };
      // A terminal wallet receipt reuses the commit tool name and carries a
      // member commit_id, but only the accepting event starts a continuation.
      const commits = Array.isArray(result.commits)
        ? result.commits
        : result.status === undefined ||
            result.status === "pending_approval" ||
            result.status === "commit_staged"
          ? [result]
          : [];
      for (const entry of commits) {
        if (!entry || typeof entry !== "object") continue;
        const commit = entry as {
          commit_id?: unknown;
          batch?: { batch_id?: unknown };
        };
        const operationId = commit.batch?.batch_id ?? commit.commit_id;
        if (typeof operationId === "string" && operationId.length > 0) {
          const callbackTurn = `broadcast-terminal:${operationId}`;
          if (!owners.has(callbackTurn))
            owners.set(callbackTurn, event.turn_id);
        }
      }
    } catch {
      // A failed or malformed tool has no continuation to group.
    }
  }
  return owners;
}

/** The logical turn stays open while its wallet callback has not finished. */
export function walletContinuationPending(
  continuationTurnIds: readonly string[],
  events: readonly Event[],
): boolean {
  return continuationTurnIds.some((callbackId) => {
    const callbackState = events.findLast(
      (candidate) =>
        candidate.type === "turn_state_changed" &&
        candidate.turn_id === callbackId,
    );
    return !(
      callbackState?.type === "turn_state_changed" &&
      ["complete", "failed", "interrupted"].includes(callbackState.state)
    );
  });
}

/** Assistant UI's running state for the latest logical message. */
export function logicalTurnRunning(
  events: readonly Event[],
  messages: readonly ThreadMessageLike[],
  turnState?: TurnState,
  isSubmitting = false,
  pendingUserMessage?: string,
): boolean {
  events = projectConversationEvents(events);
  // An accepted start can precede its durable user event in a later page.
  if (isSubmitting || pendingUserMessage) return true;
  // A late callback completion belongs to its original operation. It must
  // neither stop a newer user turn nor let a stale global state keep Stop on
  // a logical operation whose own durable callback has already completed.
  const latestUserTurn = events.findLast(
    (event) => event.type === "message" && event.sender === "user",
  )?.turn_id;
  const ownState = latestUserTurn
    ? events.findLast(
        (event) =>
          event.type === "turn_state_changed" &&
          event.turn_id === latestUserTurn,
      )
    : undefined;
  const state =
    ownState?.type === "turn_state_changed" ? ownState.state : turnState;
  const latestMessage = latestUserTurn
    ? messages.find((message) => message.id === `turn:${latestUserTurn}`)
    : messages.at(-1);
  const continuationTurnIds =
    latestMessage?.role === "assistant"
      ? (
          latestMessage.metadata?.custom as
            | { aomiContinuationTurnIds?: string[] }
            | undefined
        )?.aomiContinuationTurnIds
      : undefined;
  return (
    state === "processing" ||
    state === "awaiting_action" ||
    walletContinuationPending(continuationTurnIds ?? [], events)
  );
}

/** Walk callback ancestry without allowing malformed cycles to merge turns. */
function rootTurn(turnId: string, owners: ReadonlyMap<string, string>): string {
  let current = turnId;
  const seen = new Set<string>();
  while (true) {
    const parent = owners.get(current);
    if (parent === undefined) return current;
    if (seen.has(current)) return turnId;
    seen.add(current);
    current = parent;
  }
}

/**
 * Pure Assistant UI projection over the ordered event ledger the server sent.
 * Messages and tool parts are grouped by backend turn identity; no transcript
 * or lifecycle state is stored outside ClientSession.
 */
export function projectAssistantMessages(
  events: readonly Event[],
): ThreadMessageLike[] {
  events = projectConversationEvents(events);
  const output: Array<ThreadMessageLike | AssistantProjection> = [];
  const assistantTurns = new Map<string, AssistantProjection>();
  const terminalTurns = new Map<
    string,
    { state: TurnState; sequence: number }
  >();
  for (const event of events) {
    if (event.type === "turn_state_changed" && event.turn_id) {
      terminalTurns.set(event.turn_id, {
        state: event.state,
        sequence: event.sequence,
      });
    }
  }
  const standaloneMessages = new Map<string, number>();
  let userMessageOrdinal = 0;
  let legacyTurnKey = `legacy:${events[0]?.event_id ?? "empty"}`;
  const continuationOwners = commitContinuationOwners(events);
  const continuationTurnIds = new Map<string, string[]>();
  const parentsWithCallbacks = new Set(continuationOwners.values());
  for (const callbackTurn of continuationOwners.keys()) {
    const root = rootTurn(callbackTurn, continuationOwners);
    if (root === callbackTurn) continue;
    const siblings = continuationTurnIds.get(root) ?? [];
    siblings.push(callbackTurn);
    continuationTurnIds.set(root, siblings);
  }
  const wireTurnKeys = events.map((event) => {
    if (event.type === "message" && event.sender === "user") {
      legacyTurnKey = `legacy:${event.event_id}`;
    }
    return event.turn_id ?? legacyTurnKey;
  });
  const turnKeys = wireTurnKeys.map((turnKey) =>
    rootTurn(turnKey, continuationOwners),
  );
  // Inline transcript results and typed progress are revisions of the same
  // persisted call, even when a wallet callback has a different wire turn.
  // A tool name alone is not identity: repeated calls must remain distinct.
  const assistantTurn = (event: Event, index: number): AssistantProjection => {
    const key = turnKeys[index]!;
    const existing = assistantTurns.get(key);
    if (existing) return existing;
    const projection: AssistantProjection = {
      message: {
        id: `turn:${key}`,
        role: "assistant",
        content: [],
        createdAt: new Date(parseTimestamp(event.occurred_at)),
      },
      parts: [],
      textParts: new Map(),
      toolParts: new Map(),
    };
    assistantTurns.set(key, projection);
    output.push(projection);
    return projection;
  };

  for (const [index, event] of events.entries()) {
    if (event.type === "message") {
      if (event.sender === "system") continue;
      if (event.sender === "agent") {
        const projection = assistantTurn(event, index);
        const key = event.message_key ?? event.event_id;
        const toolResult = inlineToolResult(event);
        if (toolResult) {
          upsertPart(
            projection,
            projection.toolParts,
            event.tool_call_id ?? `inline:${key}`,
            inlineToolPart(toolResult, key, event.tool_call_id),
          );
        } else {
          if (
            continuationOwners.has(event.turn_id ?? "") &&
            !parentsWithCallbacks.has(event.turn_id ?? "") &&
            turnKeys[index] !== event.turn_id &&
            key === `${event.turn_id}:response`
          ) {
            projection.finalAnswerStartIndex ??= projection.parts.length;
          }
          const terminal = terminalTurns.get(event.turn_id ?? "");
          if (
            event.message_key &&
            event.content.trim() &&
            event.is_streaming !== true &&
            terminal?.state === "complete"
          )
            projection.responseMessageKey = event.message_key;
          upsertPart(projection, projection.textParts, key, {
            type: "text",
            text: event.content,
          } as MessageContentPart);
        }
        continue;
      }

      let projected = toInboundMessage(event, output.length);
      if (!projected) continue;
      const key = event.message_key ?? event.event_id;
      const existingIndex = standaloneMessages.get(key);
      if (existingIndex === undefined) {
        if (projected.role === "user") {
          projected = { ...projected, id: userMessageId(userMessageOrdinal++) };
        }
        standaloneMessages.set(key, output.length);
        output.push(projected);
      } else {
        const previous = output[existingIndex];
        output[existingIndex] =
          projected.role === "user" && previous && !("parts" in previous)
            ? { ...projected, id: previous.id }
            : projected;
      }
      continue;
    }

    if (
      event.type === "context_compacting" ||
      event.type === "context_compacted" ||
      event.type === "tool_output_trimmed"
    ) {
      const projection = assistantTurn(event, index);
      upsertPart(
        projection,
        projection.toolParts,
        contextKey(event),
        contextPart(event),
      );
      continue;
    }

    if (
      (event.type === "tool_update" || event.type === "tool_complete") &&
      event.tool_name !== "task"
    ) {
      const projection = assistantTurn(event, index);
      upsertPart(
        projection,
        projection.toolParts,
        event.call_id ?? event.id,
        toolPart(event),
      );
    }
  }

  return output
    .map((entry) => {
      if (!("parts" in entry)) return entry;
      const root = entry.message.id.slice("turn:".length);
      const callbackTurns = continuationTurnIds.get(root);
      const callbackTerminalStates = Object.fromEntries(
        (callbackTurns ?? []).flatMap((turnId) => {
          const state = terminalTurns.get(turnId)?.state;
          return state && ["complete", "failed", "interrupted"].includes(state)
            ? [[turnId, state]]
            : [];
        }),
      );
      return {
        ...entry.message,
        content: entry.parts as ThreadMessageLike["content"],
        ...(entry.finalAnswerStartIndex !== undefined ||
        callbackTurns ||
        entry.responseMessageKey ||
        terminalTurns.has(root)
          ? {
              metadata: {
                custom: {
                  ...(terminalTurns.has(root)
                    ? { aomiTurnState: terminalTurns.get(root)!.state }
                    : {}),
                  ...(entry.responseMessageKey
                    ? { aomiResponseMessageKey: entry.responseMessageKey }
                    : {}),
                  ...(entry.finalAnswerStartIndex !== undefined
                    ? { aomiFinalAnswerStartIndex: entry.finalAnswerStartIndex }
                    : {}),
                  ...(callbackTurns
                    ? { aomiContinuationTurnIds: callbackTurns }
                    : {}),
                  ...(Object.keys(callbackTerminalStates).length
                    ? { aomiContinuationTurnStates: callbackTerminalStates }
                    : {}),
                },
              },
            }
          : {}),
      };
    })
    .filter(
      (message) =>
        typeof message.content === "string" || message.content.length > 0,
    );
}

/**
 * Project the external-store snapshot, including the user message that has
 * been submitted but has not reached the event ledger yet.
 *
 * User ids are ordinal because the ledger is append-only. This gives the
 * optimistic row and its eventual server row the same identity, so
 * assistant-ui updates the row instead of retaining both as sibling branches.
 */
export function projectRuntimeMessages(
  events: readonly Event[],
  pendingUserMessage?: string,
  liveMessages: readonly MessageEvent[] = [],
  stoppedTurnId?: string,
  terminalTurns: SessionSnapshot["terminalTurns"] = [],
  pendingReplacesMessageKey?: string,
): ThreadMessageLike[] {
  const visible = [...events];
  for (const message of liveMessages) {
    let index = visible.findIndex((event) => {
      const runtimeSequence = event.runtime_sequence;
      if (
        event.turn_id === message.turn_id &&
        runtimeSequence !== undefined &&
        message.runtime_sequence !== undefined
      )
        return runtimeSequence > message.runtime_sequence;
      return event.sequence > message.sequence;
    });
    if (index < 0) index = visible.length;
    visible.splice(index, 0, message);
  }
  // Scoped ACKs can precede their durable events in bounded history. Retain
  // the actual outcome across newer turns, without changing the audit ledger.
  const acknowledged = new Map(
    (terminalTurns ?? []).map((turn) => [turn.turnId, turn.state]),
  );
  if (stoppedTurnId && !acknowledged.has(stoppedTurnId))
    acknowledged.set(stoppedTurnId, "interrupted");
  for (const [turnId, state] of acknowledged) {
    const latestState = visible.findLast(
      (event) =>
        event.type === "turn_state_changed" && event.turn_id === turnId,
    );
    if (
      latestState?.type === "turn_state_changed" &&
      ["complete", "failed", "interrupted"].includes(latestState.state)
    )
      continue;
    const durableTerminal = visible.findLast(
      (event) =>
        event.type === "turn_state_changed" &&
        event.turn_id === turnId &&
        ["complete", "failed", "interrupted"].includes(event.state),
    );
    visible.push({
      type: "turn_state_changed",
      event_id: `terminal-ack:${turnId}`,
      turn_id: turnId,
      state:
        durableTerminal?.type === "turn_state_changed"
          ? durableTerminal.state
          : state,
      sequence: (visible.at(-1)?.sequence ?? 0) + 1,
      occurred_at: Date.now() / 1000,
    });
  }
  const projected = projectAssistantMessages(visible);
  if (pendingUserMessage === undefined) return projected;
  // Edit and Rerun replace the conversation from this user message onward.
  const replaced = projected.findIndex(
    (message) =>
      message.role === "user" &&
      message.metadata?.custom?.aomiUserMessageKey ===
        pendingReplacesMessageKey,
  );
  if (pendingReplacesMessageKey && replaced >= 0) projected.length = replaced;

  const userMessageOrdinal = projected.reduce(
    (count, message) => count + Number(message.role === "user"),
    0,
  );
  const capabilityHints = extractCapabilityHints(pendingUserMessage);
  projected.push({
    id: userMessageId(userMessageOrdinal),
    role: "user",
    content: [{ type: "text", text: stripCapabilityHints(pendingUserMessage) }],
    createdAt: new Date(),
    ...(capabilityHints.length > 0
      ? { metadata: { custom: { aomiCapabilityHints: capabilityHints } } }
      : {}),
  });
  return projected;
}
