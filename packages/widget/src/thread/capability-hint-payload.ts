import {
  capabilityHintPayload,
  type CapabilitySelection,
} from "@aomi-labs/client";
import type { AgentMode } from "@aomi-labs/react";

export type CapabilityHintSelection = CapabilitySelection;

/** The send's capability hints; only Auto routes by them. */
export function buildCapabilityHintPayload(
  mode: AgentMode,
  selections: readonly CapabilityHintSelection[],
  removedAgents: readonly CapabilityHintSelection[] = [],
) {
  return mode === "auto"
    ? capabilityHintPayload(selections, removedAgents)
    : undefined;
}
