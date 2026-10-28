import { type AgentMode } from "@aomi-labs/client";

export type CapabilityHintSelection = {
  kind: "app" | "skill" | "chain" | "wallet";
  id: string;
  label?: string;
  appName?: string;
  /** A wallet: the `w_N` id of each address, one hint apiece. */
  walletIds?: readonly string[];
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
    capabilities: selections.flatMap(
      ({ kind, id, label, appName, walletIds }) =>
        (kind === "wallet" && walletIds?.length ? walletIds : [id]).map(
          (hintId) => ({
            kind,
            id: hintId,
            ...((kind === "app" || kind === "wallet") && label
              ? { label }
              : {}),
            ...(kind === "app" && appName ? { appName } : {}),
          }),
        ),
    ),
  };
}
