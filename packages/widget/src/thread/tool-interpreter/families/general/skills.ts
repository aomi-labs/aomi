import { getSkillDisplayName } from "@/icons/skills/skill-icons";
import { asRecord } from "@/thread/tool-interpreter/normalize";

import type { ToolMatcher } from "@/thread/tool-interpreter/types";
import { operation } from "@/thread/tool-interpreter/families/operation";

export const matchSkillActivation: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  const requested = asRecord(parsedArgs)?.skill_ids;
  if (
    !resultRecord &&
    /^(?:activate_skills|Activate skills)$/i.test(rawLabel) &&
    Array.isArray(requested)
  ) {
    return operation(
      "skill.activate",
      rawLabel,
      requested
        .filter((id): id is string => typeof id === "string")
        .map((value) => ({
          kind: "skill" as const,
          value,
          label: getSkillDisplayName(value),
          source: "args" as const,
        })),
    );
  }
  if (!resultRecord) return null;
  if (!("activated" in resultRecord || "applied_scope" in resultRecord)) {
    return null;
  }

  const activated = Array.isArray(resultRecord.activated)
    ? resultRecord.activated.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const active = Array.isArray(resultRecord.active_skill_ids)
    ? resultRecord.active_skill_ids.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      )
    : [];
  const checking = activated.length === 0;

  return operation(
    checking ? "skill.check" : "skill.activate",
    rawLabel,
    (checking ? active : activated).map((value) => ({
      kind: "skill",
      value,
      label: getSkillDisplayName(value),
      source: "result" as const,
    })),
  );
};
