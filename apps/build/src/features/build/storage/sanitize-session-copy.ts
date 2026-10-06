import type {
  BuildMessage,
  BuildSession,
  BuildStreamEvent,
  SmithersNode,
} from "@/features/build/contracts";

/**
 * Rewrite eng/mock jargon that may still live in localStorage from older
 * Create sessions. Display-time safety net until storage is rewritten.
 */

const LEGACY_NODE_LABELS: Record<
  string,
  Pick<SmithersNode, "label" | "role" | "detail">
> = {
  "smithers compose": {
    label: "Compose plan",
    role: "Planner",
    detail: "Turn your intent into ordered build steps",
  },
  "aomi-openapi-gen": {
    label: "API tools",
    role: "Generator",
    detail: "Scaffold tools from the APIs in your prompt",
  },
  "aomi-openapi-gen hype": {
    label: "Hyperliquid tools",
    role: "Generator",
    detail: "Scaffold exchange client and agent tools",
  },
  "aomi-openapi-gen binance": {
    label: "Binance tools",
    role: "Generator",
    detail: "Scaffold exchange client and agent tools",
  },
  "arb-bot aomi-run": {
    label: "Smoke test",
    role: "Tester",
    detail: "Exercise the agent after compile",
  },
};

function roleFromLegacyAgent(agent: unknown): string {
  if (agent === "local") return "Planner";
  if (agent === "claude") return "Tester";
  return "Generator";
}

function sanitizePlainText(raw: string): string {
  return raw
    .replace(/\bReal\s+Smithers\s+SSE\s+is\s+not\s+wired\s+yet\.?/gi, "")
    .replace(/\bSmithers\s+SSE\b/gi, "live generate")
    .replace(/\bComposing\s+Smithers\s+nodes\b/gi, "Drafting plan steps")
    .replace(/\bSmithers\s+nodes\b/gi, "plan steps")
    .replace(/\bSmithers\b/gi, "plan")
    .replace(/\baomi-openapi-gen(?:\s+\w+)?/gi, "API tools")
    .replace(/\barb-bot\s+aomi-run\b/gi, "Smoke test")
    .replace(/\btest(?:ing)?\s+with\s+aomi-run\b/gi, "run a smoke test")
    .replace(/\baomi-run\b/gi, "smoke test")
    .replace(/\s*\(local\s+mock\)\.?/gi, "")
    .replace(/\blocal\s+mock\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!])/g, "$1")
    .replace(/\.\s*\./g, ".")
    .trim();
}

function sanitizeModel(model: string | undefined): string | undefined {
  if (!model) return model;
  const lower = model.toLowerCase().trim();
  if (
    lower === "local mock" ||
    lower === "aomi · local mock" ||
    lower.includes("local mock")
  ) {
    return "Aomi";
  }
  return model;
}

function sanitizeMessage(message: BuildMessage): BuildMessage {
  return {
    ...message,
    content: sanitizePlainText(message.content),
    model: sanitizeModel(message.model),
  };
}

function sanitizeStreamEvent(event: BuildStreamEvent): BuildStreamEvent {
  return {
    ...event,
    message: sanitizePlainText(event.message),
  };
}

function sanitizeNode(node: SmithersNode & { agent?: string }): SmithersNode {
  const key = (node.label ?? "").toLowerCase().trim();
  const mapped = LEGACY_NODE_LABELS[key];
  if (mapped) {
    return {
      id: node.id,
      label: mapped.label,
      role: mapped.role,
      detail: mapped.detail,
      status: node.status,
    };
  }

  const legacyAgent = "agent" in node ? node.agent : undefined;
  return {
    id: node.id,
    label: sanitizePlainText(node.label),
    role: node.role || roleFromLegacyAgent(legacyAgent),
    detail: sanitizePlainText(node.detail),
    status: node.status,
  };
}

export function sanitizeBuildSession(session: BuildSession): BuildSession {
  return {
    ...session,
    model: sanitizeModel(session.model) ?? "Aomi",
    messages: session.messages.map(sanitizeMessage),
    streamEvents: session.streamEvents.map(sanitizeStreamEvent),
    nodes: session.nodes?.map((n) => sanitizeNode(n as SmithersNode & { agent?: string })),
  };
}

export function sessionsNeedSanitize(sessions: BuildSession[]): boolean {
  return sessions.some((session) => {
    const cleaned = sanitizeBuildSession(session);
    return JSON.stringify(cleaned) !== JSON.stringify(session);
  });
}
