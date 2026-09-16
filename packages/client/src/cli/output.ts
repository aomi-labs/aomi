import type {
  Event,
  MessageEvent,
  TaskActivityEvent,
  TaskCompletedEvent,
  TaskStartedEvent,
  ToolCompleteEvent,
  ToolUpdateEvent,
} from "../agent/types";
import type { CliPaymentEvent } from "./payment";
import { STATE_ROOT_DIR, getActiveStateFilePath } from "./state";

export const DIM = "\x1b[2m";
export const CYAN = "\x1b[36m";
export const YELLOW = "\x1b[33m";
export const GREEN = "\x1b[32m";
export const RESET = "\x1b[0m";

export function printDataFileLocation(options?: { verbose?: boolean }): void {
  if (options?.verbose !== true) {
    return;
  }
  const activeFile = getActiveStateFilePath();
  if (activeFile) {
    console.log(`Data stored at ${activeFile} 📝`);
    return;
  }
  console.log(`Data stored under ${STATE_ROOT_DIR} 📝`);
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

type ToolEvent = ToolUpdateEvent | ToolCompleteEvent;

export type InlineToolResult = {
  name: string;
  result: string;
  turnId: string;
};

export function inlineToolResultFromMessage(
  event: MessageEvent,
): InlineToolResult | null {
  // The fields are declared on MessageEvent, but the wire is still untrusted
  // input — validate before use.
  const raw: unknown = event.tool_result;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const [topic, result] = raw;
  if (typeof topic !== "string" || typeof result !== "string") return null;
  return {
    name:
      typeof event.tool_name === "string" && event.tool_name.length > 0
        ? event.tool_name
        : topic,
    result,
    turnId: event.turn_id ?? `event:${event.event_id}`,
  };
}

export function countToolCalls(events: readonly Event[]): number {
  // Subagent lifecycles ("task") are not tool calls, and an inline-tool
  // message is a duplicate only of a typed completion for the SAME tool in
  // the same turn — deduping by turn alone undercounts turns mixing inline
  // and async tools.
  const typedToolPairs = new Set(
    events.flatMap((event) =>
      event.type === "tool_complete" && event.tool_name !== "task"
        ? [`${event.turn_id ?? `event:${event.event_id}`}::${event.tool_name}`]
        : [],
    ),
  );
  return events.filter((event) => {
    if (event.type === "tool_complete") return event.tool_name !== "task";
    if (event.type !== "message") return false;
    const tool = inlineToolResultFromMessage(event);
    return tool !== null && !typedToolPairs.has(`${tool.turnId}::${tool.name}`);
  }).length;
}

export function printToolComplete(event: ToolEvent): void {
  const name = getToolNameFromEvent(event);
  const result = getToolResultFromEvent(event);
  const line = formatToolResultLine(name, result);
  console.log(line);
}

// ---------------------------------------------------------------------------
// Orchestrator delegation lines (verbose mode only — see chat command)
// ---------------------------------------------------------------------------

const TASK_LINE_MAX = 100;

export function printTaskStarted(event: TaskStartedEvent): void {
  const label = event.label || event.agent_id;
  console.log(`${CYAN}◆ [agent] ${label} started${RESET}`);
}

export function printTaskActivity(event: TaskActivityEvent): void {
  console.log(`${DIM}  ↳ ${formatTaskActivity(event)}${RESET}`);
}

export function printTaskCompleted(
  event: TaskCompletedEvent,
  label?: string,
): void {
  const color = event.status === "completed" ? GREEN : "\x1b[31m";
  const mark = event.status === "completed" ? "✔" : "✖";
  console.log(
    `${color}  ${mark} ${label || event.agent_id}: ${event.status} (${formatTaskCompletionStats(event)})${RESET}`,
  );
}

/** `tool_call` → tool name, `note` → note text. Truncated for one-line output. */
export function formatTaskActivity(event: TaskActivityEvent): string {
  const raw = event.kind === "note" ? event.text : event.tool_name;
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= TASK_LINE_MAX) return normalized;
  return `${normalized.slice(0, TASK_LINE_MAX)}…`;
}

export function formatTaskCompletionStats(event: TaskCompletedEvent): string {
  const steps = event.steps;
  const seconds = (event.duration_ms / 1000).toFixed(1);
  return `${steps} ${steps === 1 ? "step" : "steps"}, ${seconds}s`;
}

export function printToolResultLine(name: string, result?: string): void {
  console.log(formatToolResultLine(name, result));
}

export function printPaymentEvent(event: CliPaymentEvent): void {
  switch (event.type) {
    case "required": {
      const requirement = event.requirement;
      const details = [
        requirement?.amount ? `amount ${requirement.amount}` : undefined,
        requirement?.network,
        requirement?.payTo ? `beneficiary ${requirement.payTo}` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
      console.error(
        `${YELLOW}💳 x402 payment required${details ? `: ${details}` : ""}${RESET}`,
      );
      return;
    }
    case "submitting":
      console.error(`${DIM}✍️ Signing and submitting x402 payment…${RESET}`);
      return;
    case "settled":
      console.error(
        `${GREEN}✔ x402 payment settled${event.receiptId ? `: ${event.receiptId}` : ""}${RESET}`,
      );
      return;
    case "rejected":
      console.error(
        `\x1b[31m✖ x402 payment rejected (HTTP ${event.status})${event.reason ? `: ${event.reason}` : ""}${RESET}`,
      );
  }
}

export function getToolNameFromEvent(event: ToolEvent): string {
  return event.tool_name;
}

export function getToolResultFromEvent(event: ToolEvent): string | undefined {
  return typeof event.result === "string"
    ? event.result
    : JSON.stringify(event.result);
}

export function toToolResultKey(name: string, result?: string): string {
  return `${name}\n${result ?? ""}`;
}

export function isAlwaysVisibleTool(name: string): boolean {
  const normalized = name.toLowerCase();
  if (
    normalized.includes("encode_and_simulate") ||
    normalized.includes("encode-and-simulate") ||
    normalized.includes("encode_and_view") ||
    normalized.includes("encode-and-view")
  ) {
    return true;
  }
  if (normalized.startsWith("simulate ")) {
    return true;
  }
  return false;
}

export function printNewAgentMessages(
  messages: readonly MessageEvent[],
  lastPrintedCount: number,
): number {
  const agentMessages = messages.filter(
    (message) => message.sender === "agent",
  );

  let handled = lastPrintedCount;
  for (let i = lastPrintedCount; i < agentMessages.length; i++) {
    const message = agentMessages[i];
    if (message.is_streaming) {
      break;
    }
    if (message.content) {
      console.log(`${CYAN}🤖 ${message.content}${RESET}`);
    }
    handled = i + 1;
  }

  return handled;
}

export function formatLogContent(content?: string | null): string | null {
  if (!content) return null;
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatToolResultPreview(
  result: string,
  maxLength = 200,
): string {
  const normalized = result.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}…`;
}

function formatToolResultLine(name: string, result?: string): string {
  if (!result) {
    return `${GREEN}✔ [tool] ${name} done${RESET}`;
  }
  return `${GREEN}✔ [tool] ${name} → ${formatToolResultPreview(result, 120)}${RESET}`;
}
