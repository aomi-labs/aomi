import type { AgentMode } from "@aomi-labs/react";

export type CapabilityHintSelection = {
  kind: "app" | "skill" | "chain";
  id: string;
  label?: string;
};

export function buildCapabilityHintPayload(
  mode: AgentMode,
  selections: readonly CapabilityHintSelection[],
  removedApps: readonly CapabilityHintSelection[] = [],
):
  | {
      capabilities: CapabilityHintSelection[];
      removedApps?: CapabilityHintSelection[];
    }
  | undefined {
  if (mode !== "auto" || (selections.length === 0 && removedApps.length === 0))
    return undefined;
  return {
    ...(removedApps.length
      ? {
          removedApps: removedApps.map(({ id, label }) => ({
            kind: "app" as const,
            id,
            label,
          })),
        }
      : {}),
    capabilities: selections.map(({ kind, id, label }) => ({
      kind,
      id,
      ...(kind === "app" && label ? { label } : {}),
    })),
  };
}
