import type { AgentCard } from "./types";

/** Read the key-resolution response; never infer a hosted identity from a name. */
export function normalizeAgentCard(value: unknown): AgentCard | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(row.agent_id) ||
    typeof row.agent !== "string" ||
    !/^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*$/.test(row.agent) ||
    typeof row.display_name !== "string"
  )
    return null;
  return {
    agent_id: row.agent_id as number,
    agent: row.agent,
    display_name: row.display_name,
    metadata:
      row.metadata &&
      typeof row.metadata === "object" &&
      !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}

export function agentIdentityKey(card: AgentCard): string {
  return `agent:${card.agent}`;
}
