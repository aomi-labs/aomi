import { getSkillDisplayName } from "@/components/icons/skills";

import type { ToolMatcher } from "../../types";
import { operation } from "../operation";

export const matchSkillActivation: ToolMatcher = ({
  rawLabel,
  resultRecord,
}) => {
  if (!resultRecord) return null;
  if (!("activated" in resultRecord || "applied_scope" in resultRecord)) {
    return null;
  }

  const activated = Array.isArray(resultRecord.activated)
    ? resultRecord.activated.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  return operation(
    "skill.activate",
    rawLabel,
    activated.length > 0
      ? activated.map((value) => ({
          kind: "skill",
          value,
          label: getSkillDisplayName(value),
          source: "result" as const,
        }))
      : [{ kind: "skill", value: "Skill", source: "result" }],
  );
};
