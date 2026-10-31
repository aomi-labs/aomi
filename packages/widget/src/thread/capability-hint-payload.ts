import {
  capabilityHintPayload,
  type AgentMode,
  type CapabilitySelection,
} from "@aomi-labs/client";

export type CapabilityHintSelection = CapabilitySelection;

/** The send's capability hints; only Auto routes by them. */
export function buildCapabilityHintPayload(
  mode: AgentMode,
  selections: readonly CapabilityHintSelection[],
  removedApps: readonly CapabilityHintSelection[] = [],
) {
  return mode === "auto"
    ? capabilityHintPayload(selections, removedApps)
    : undefined;
}
