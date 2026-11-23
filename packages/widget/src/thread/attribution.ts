import type { AgentCard } from "@aomi-labs/client";
import {
  decode,
  type InterpretedToolStep,
  type ToolChip,
  type ToolStepInput,
} from "@aomi-labs/client/trace";
import { resolveAgentIdentity } from "@aomi-labs/client";
import { skillLabel } from "@/composer/capabilities/skill-label";
import type { PickerItem } from "@/composer/capability-composer/model";

export type TraceAttribution = {
  agents?: readonly AgentCard[];
  /** Hosted packages with the icon the composer and the Library show. */
  packages?: readonly Pick<PickerItem, "id" | "label" | "Icon">[];
};

function agentChip(name: string, catalog?: TraceAttribution): ToolChip {
  const matches =
    catalog?.agents?.filter((agent) => agent.agent === name) ?? [];
  // Duplicate hosted names do not identify a particular publisher.
  const identity = resolveAgentIdentity(
    matches.length === 1 ? matches[0]! : name,
  );
  return {
    id: `agent:${name}`,
    attribution: "agent",
    label: identity.displayName,
    title: `Agent: ${identity.displayName}`,
    icon:
      matches.length === 1 && identity.brandId
        ? `toolset:${identity.brandId}`
        : "toolset",
  };
}

/** An activated package by its catalog name. `detail` (the skills it
 * brought) goes on hover. */
export function packageChip(
  id: string,
  catalog?: TraceAttribution,
  detail?: string,
): ToolChip {
  const label =
    catalog?.packages?.find((item) => item.id === id)?.label ??
    skillLabel({ name: id.split("/").at(-1) ?? id });
  return {
    id: `package:${id}`,
    packageId: id,
    label,
    title: detail ? `${label} · ${detail}` : `Package: ${label}`,
    icon: id.includes("/") ? "package" : `skill:${id}`,
  };
}

/** Attribute only declared ownership; an activated package does not own every
 * generic tool called after it (for example get_chain_context or stage_tx). */
export function attributeToolStep(
  step: InterpretedToolStep,
  rawLabel: string,
  catalog?: TraceAttribution,
): InterpretedToolStep {
  const agents =
    catalog?.agents?.filter(
      (agent) =>
        Array.isArray(agent.metadata?.tool_names) &&
        agent.metadata.tool_names.includes(rawLabel),
    ) ?? [];
  // Exact declarations only. A prefix, selected agent, or prior activation
  // cannot establish who supplied a tool. Ambiguous bare names stay untagged.
  const chips = [
    ...step.chips.map((chip) =>
      chip.packageId ? packageChip(chip.packageId, catalog, chip.title) : chip,
    ),
    ...(agents.length === 1 ? [agentChip(agents[0]!.agent, catalog)] : []),
  ];
  const seen = new Set<string>();
  return {
    ...step,
    chips: chips.filter((chip) => {
      const key = chip.id ?? chip.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

/** A decoded step with the agent that declares its tool. */
export const interpretToolStep = (
  input: ToolStepInput & { attribution?: TraceAttribution },
): InterpretedToolStep =>
  attributeToolStep(decode(input), input.toolName, input.attribution);
