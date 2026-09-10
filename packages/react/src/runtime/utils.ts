import type { ThreadMessageLike } from "@assistant-ui/react";

import {
  SUPPORTED_CHAINS as CLIENT_SUPPORTED_CHAINS,
  type ChainInfo,
  type Event,
  type MessageEvent,
  type ToolCompleteEvent,
  type ToolUpdateEvent,
  type UserState,
} from "@aomi-labs/client";

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  extractCapabilityHints,
  stripCapabilityHints,
} from "./capability-hints";

/**
 * Utility function to merge Tailwind CSS classes with conflict resolution.
 * Combines clsx for conditional classes and tailwind-merge for deduplication.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ==================== Thread Utilities ====================

export const parseTimestamp = (value?: string | number) => {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : 0;
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }

  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
};

export const isPlaceholderTitle = (title?: string) => {
  const normalized = title?.trim() ?? "";
  return !normalized || normalized.startsWith("#[");
};

// ==================== Message Conversion ====================

type MessageContentPart =
  Exclude<ThreadMessageLike["content"], string> extends readonly (infer U)[]
    ? U
    : never;

const userMessageId = (ordinal: number) => `aomi-user-${ordinal}`;

export function toInboundMessage(
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
    ...(capabilityHints.length > 0
      ? { metadata: { custom: { aomiCapabilityHints: capabilityHints } } }
      : {}),
  } satisfies ThreadMessageLike;

  return threadMessage;
}

type AssistantProjection = {
  message: ThreadMessageLike;
  parts: MessageContentPart[];
  textParts: Map<string, number>;
  toolParts: Map<string, number>;
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
    projection.parts[index] = part;
  }
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
 * (declared on the client's MessageEvent shape). Until the recorder emits
 * real tool_update/tool_complete events for inline tools, this is the only
 * wire shape those steps arrive in; drop it and every trace renders as an
 * empty "Working" shell.
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

/**
 * Pure Assistant UI projection over the canonical ordered event ledger.
 * Messages and tool parts are grouped by backend turn identity; no transcript
 * or lifecycle state is stored outside ClientSession.
 */
export function projectAssistantMessages(
  events: readonly Event[],
): ThreadMessageLike[] {
  const output: Array<ThreadMessageLike | AssistantProjection> = [];
  const assistantTurns = new Map<string, AssistantProjection>();
  const standaloneMessages = new Map<string, number>();
  let userMessageOrdinal = 0;
  let legacyTurnKey = `legacy:${events[0]?.event_id ?? "empty"}`;
  const turnKeys = events.map((event) => {
    if (event.type === "message" && event.sender === "user") {
      legacyTurnKey = `legacy:${event.event_id}`;
    }
    return event.turn_id ?? legacyTurnKey;
  });
  // Inline results only ever arrive as `tool_result` message events, so an
  // inline part may be suppressed only when the SAME tool also produced a
  // typed completion in the turn — suppressing per turn would drop a sync
  // tool's only trace whenever any other tool in the turn completed typed.
  const typedToolKey = (turn: string, toolName: string) =>
    `${turn}::${toolName}`;
  const typedToolCompletions = new Set(
    events.flatMap((event, index) =>
      event.type === "tool_complete" && event.tool_name !== "task"
        ? [typedToolKey(turnKeys[index]!, event.tool_name)]
        : [],
    ),
  );

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
          if (
            !typedToolCompletions.has(
              typedToolKey(turnKeys[index]!, toolResult.toolName),
            )
          ) {
            upsertPart(
              projection,
              projection.toolParts,
              key,
              inlineToolPart(toolResult, key, event.tool_call_id),
            );
          }
        } else {
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
      return {
        ...entry.message,
        content: entry.parts as ThreadMessageLike["content"],
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
): ThreadMessageLike[] {
  const projected = projectAssistantMessages(events);
  if (pendingUserMessage === undefined) return projected;

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

// ==================== Wallet Utilities ====================

/**
 * User configuration props for footer components.
 * Provides user state and setter from UserContext.
 */
export type UserConfig = {
  user: UserState;
  setUser: (data: Partial<UserState>) => void;
};

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export const getNetworkName = (
  chainId: number | string | undefined,
): string => {
  if (chainId === undefined) return "";
  const id = typeof chainId === "string" ? Number(chainId) : chainId;
  switch (id) {
    case 1:
      return "ethereum";
    case 137:
      return "polygon";
    case 42161:
      return "arbitrum";
    case 8453:
      return "base";
    case 10:
      return "optimism";
    case 11155111:
      return "sepolia";
    case 143:
      return "monad";
    case 10143:
      return "monad-testnet";
    case 4326:
      return "megaeth";
    case 5042002:
      return "arc-testnet";
    case 1337:
    case 31337:
      return "testnet";
    case 59141:
      return "linea-sepolia";
    case 59144:
      return "linea";
    default:
      return "testnet";
  }
};

export const formatAddress = (addr?: string): string =>
  addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "Connect Wallet";

// ==================== Chain Metadata ====================

export type { ChainInfo } from "@aomi-labs/client";

/** All chains supported by the application. Sourced from @aomi-labs/client. */
export const SUPPORTED_CHAINS: ChainInfo[] = [...CLIENT_SUPPORTED_CHAINS];

/** Look up ChainInfo by chain ID. Returns undefined for unknown chains. */
export const getChainInfo = (
  chainId: number | undefined,
): ChainInfo | undefined =>
  chainId === undefined
    ? undefined
    : SUPPORTED_CHAINS.find((c) => c.id === chainId);

export function normalizeWalletError(error: unknown): {
  rejected: boolean;
  message: string;
} {
  const e = error as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
    shortMessage?: unknown;
    cause?: unknown;
  };
  const cause = (e?.cause ?? null) as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
    shortMessage?: unknown;
  } | null;

  const code =
    (typeof e?.code === "number" ? e.code : undefined) ??
    (typeof cause?.code === "number" ? cause.code : undefined);
  const name =
    (typeof e?.name === "string" ? e.name : undefined) ??
    (typeof cause?.name === "string" ? cause.name : undefined);
  const msg =
    (typeof e?.shortMessage === "string" ? e.shortMessage : undefined) ??
    (typeof cause?.shortMessage === "string"
      ? cause.shortMessage
      : undefined) ??
    (typeof e?.message === "string" ? e.message : undefined) ??
    (typeof cause?.message === "string" ? cause.message : undefined) ??
    "Unknown wallet error";

  const rejected =
    code === 4001 ||
    name === "UserRejectedRequestError" ||
    name === "RejectedRequestError" ||
    /user rejected|rejected the request|denied|request rejected|canceled|cancelled/i.test(
      msg,
    );

  return { rejected, message: msg };
}

export function toHexQuantity(value: string): string {
  const trimmed = value.trim();
  const asBigInt = BigInt(trimmed);
  return `0x${asBigInt.toString(16)}`;
}

export async function pickInjectedProvider(
  publicKey?: string,
): Promise<Eip1193Provider | undefined> {
  const ethereum = (globalThis as unknown as { ethereum?: unknown })
    .ethereum as (Eip1193Provider & { providers?: unknown[] }) | undefined;
  if (!ethereum?.request) return undefined;

  const candidates: Eip1193Provider[] = Array.isArray(ethereum.providers)
    ? (ethereum.providers.filter(
        (p): p is Eip1193Provider => !!(p as Eip1193Provider)?.request,
      ) as Eip1193Provider[])
    : [ethereum];

  const target = publicKey?.toLowerCase();
  if (target) {
    for (const candidate of candidates) {
      try {
        const accounts = (await candidate.request({
          method: "eth_accounts",
        })) as unknown;
        const list = Array.isArray(accounts)
          ? (accounts as unknown[]).map((a) => String(a).toLowerCase())
          : [];
        if (list.includes(target)) return candidate;
      } catch {
        // Ignore providers that error on eth_accounts.
      }
    }
  }

  return candidates[0];
}
