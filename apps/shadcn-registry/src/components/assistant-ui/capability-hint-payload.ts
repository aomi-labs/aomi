import type { AgentMode } from "@aomi-labs/react";

export type CapabilityHintSelection = {
  kind: "app" | "skill" | "chain";
  id: string;
};

export function buildCapabilityHintPayload(
  mode: AgentMode,
  selections: readonly CapabilityHintSelection[],
): { capabilities: CapabilityHintSelection[] } | undefined {
  if (mode !== "auto" || selections.length === 0) return undefined;
  return {
    capabilities: selections.map(({ kind, id }) => ({ kind, id })),
  };
}
