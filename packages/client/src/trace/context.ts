import type {
  ContextCompactedEvent,
  ContextCompactingEvent,
  ToolOutputTrimmedEvent,
} from "../agent/types";
import type { InterpretedToolStep, ToolChip, TraceToolPart } from "./types";

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
  | {
      kind: "trimmed";
      tool: string;
      /** Saved-output id that `read_tool_output` pages by. */
      id: string;
      bytes: number;
      tokens: number;
    };

export type ContextEvent =
  | ContextCompactingEvent
  | ContextCompactedEvent
  | ToolOutputTrimmedEvent;

/** A compaction's start and end share one part, so the live row finishes in place. */
export const contextKey = (event: ContextEvent): string =>
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
        id: event.id,
        bytes: event.bytes,
        tokens: event.tokens,
      };
  }
};

export const contextPart = (event: ContextEvent): TraceToolPart => {
  const step = contextStep(event);
  return {
    type: "tool-call",
    toolCallId: contextKey(event),
    toolName: CONTEXT_STEP_TOOL,
    args: step,
    result: step,
  };
};

/** "151k", "14k", "820" */
const tokens = (count: number): string =>
  count >= 1_000 ? `${Math.round(count / 1_000)}k` : String(count);

/** "2.1 MB", "48 KB", "512 B" */
const size = (bytes: number): string =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : bytes >= 1_024
      ? `${Math.round(bytes / 1_024)} KB`
      : `${bytes} B`;

const seconds = (ms: number): string => `${(ms / 1_000).toFixed(1)} s`;

export const interpretContextStep = (
  step: ContextStep,
): InterpretedToolStep => {
  const chip = (label: string): ToolChip => ({ label, icon: "layers" });
  switch (step.kind) {
    case "compacting":
      return {
        icon: "archive",
        title: "Summarizing earlier conversation",
        chips: [chip(`${tokens(step.tokensBefore)} tokens`)],
        confidence: "high",
        rawLabel: "context_compacting",
        failed: false,
      };
    case "compacted":
      return step.published
        ? {
            icon: "archive",
            title: "Summarized earlier conversation",
            chips: [
              chip(
                `${tokens(step.tokensBefore)} to ${tokens(step.tokensAfter)} tokens`,
              ),
            ],
            confidence: "high",
            rawLabel: "context_compacted",
            failed: false,
          }
        : {
            icon: "archive",
            title: "Could not use the summary",
            chips: [],
            confidence: "high",
            rawLabel: "context_compacted",
            failed: false,
            outcome: "incomplete",
          };
    case "trimmed":
      return {
        icon: "trim",
        title: `Trimmed ${step.tool} output`,
        chips: [chip(`${size(step.bytes)} to ${tokens(step.tokens)} tokens`)],
        confidence: "high",
        rawLabel: "tool_output_trimmed",
        failed: false,
      };
  }
};

/** The one-line explanation shown when the row is opened. */
export const contextStepDetail = (step: ContextStep): string => {
  switch (step.kind) {
    case "compacting":
      return "The conversation grew past the model's working budget, so the earlier part is being summarized. This can take a minute.";
    case "compacted":
      return step.published
        ? `The conversation grew past the model's working budget, so the earlier part was summarized (${tokens(step.tokensBefore)} to ${tokens(step.tokensAfter)} tokens, ${seconds(step.durationMs)}). Recent messages are kept word for word, and your stated limits are carried over exactly.`
        : "A summary could not be used this time, so the reply went ahead with the oldest messages left out instead.";
    case "trimmed":
      return `${step.tool} returned ${size(step.bytes)}. The model saw a shortened view of about ${tokens(step.tokens)} tokens and can read the rest when it needs it.`;
  }
};
