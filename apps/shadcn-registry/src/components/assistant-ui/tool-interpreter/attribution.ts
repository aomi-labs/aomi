import { AppWindowIcon, PuzzleIcon } from "lucide-react";
import type { AomiAppDescriptor } from "@aomi-labs/client";
import { getAppIcon } from "@/components/icons/app-map";
import { getSkillIcon } from "@/components/icons/skills";
import { resolveAppIdentity } from "../../../lib/apps/app-identity";
import { skillLabel } from "../../../lib/capabilities/skill-label";
import type { SkillSummary } from "../../../lib/capabilities/skill-catalog";
import type { InterpretedToolStep, ToolChip, ToolContext } from "./types";

export type TraceAttribution = {
  apps?: readonly AomiAppDescriptor[];
  skills?: readonly Pick<SkillSummary, "id" | "name" | "injectedTools">[];
};

function appChip(name: string, catalog?: TraceAttribution): ToolChip {
  const matches = catalog?.apps?.filter((app) => app.name === name) ?? [];
  // Duplicate hosted names do not identify a particular publisher.
  const identity = resolveAppIdentity(
    matches.length === 1 ? matches[0]! : name,
  );
  return {
    id: `app:${name}`,
    label: identity.displayName,
    title: `App: ${identity.displayName}`,
    icon:
      (matches.length > 1 ? undefined : getAppIcon(identity.brandId)) ??
      AppWindowIcon,
  };
}

export function skillChip(id: string, catalog?: TraceAttribution): ToolChip {
  const skill = catalog?.skills?.find((skill) => skill.id === id);
  const label = skillLabel({ name: skill?.name || id });
  const namespace = id.includes("/") ? id.split("/")[0] : undefined;
  const app = namespace ? appChip(namespace, catalog) : undefined;
  return {
    id: `skill:${id}`,
    skillId: id,
    label: app ? `${app.label} / ${label}` : label,
    ...(app ? { labelParts: [app.label, label] as const } : {}),
    title: app ? `${app.title} / Skill: ${label}` : `Skill: ${label}`,
    icon: app?.icon ?? getSkillIcon(id) ?? PuzzleIcon,
  };
}

/** Attribute only declared ownership; an activated skill does not own every
 * generic tool called after it (for example get_chain_context or stage_tx). */
export function attributeToolStep(
  step: InterpretedToolStep,
  ctx: ToolContext,
  catalog?: TraceAttribution,
): InterpretedToolStep {
  const candidates =
    catalog?.skills?.filter((skill) =>
      skill.injectedTools.includes(ctx.rawLabel),
    ) ?? [];
  const owners = candidates.length === 1 ? candidates : [];
  const skillChips = owners.map((skill) => skillChip(skill.id, catalog));
  const ownedApps = new Set(
    owners.flatMap((skill) =>
      skill.id.includes("/") ? [skill.id.split("/")[0]!] : [],
    ),
  );
  const apps =
    catalog?.apps?.filter(
      (app) =>
        Array.isArray(app.metadata?.tool_names) &&
        app.metadata.tool_names.includes(ctx.rawLabel),
    ) ?? [];
  // Exact declarations only. A prefix, selected app, or prior activation
  // cannot establish who supplied a tool. Ambiguous bare names stay untagged.
  const appChips =
    apps.length === 1 && !ownedApps.has(apps[0]!.name)
      ? [appChip(apps[0]!.name, catalog)]
      : [];
  const chips = [
    ...appChips,
    ...skillChips,
    ...step.chips.map((chip) =>
      chip.skillId ? skillChip(chip.skillId, catalog) : chip,
    ),
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
