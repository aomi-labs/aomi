import { asRecord } from "../../normalize";

import type { ToolFact, ToolMatcher } from "../../types";
import { operation } from "../operation";

/** The package an activated id belongs to: a hosted package's skill
 * (`<publisher>/<package>/<skill>`) names its package, any other id is one. */
export const packageOf = (id: string): string =>
  id.split("/").length === 3 ? id.slice(0, id.lastIndexOf("/")) : id;

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];

/** One fact per package, with the skills it brought as the label. */
const packageFacts = (
  ids: string[],
  source: ToolFact["source"],
): ToolFact[] => {
  const packages = new Map<string, string[]>();
  for (const id of ids) {
    const owner = packageOf(id);
    const skills = packages.get(owner) ?? [];
    if (owner !== id) skills.push(id.slice(owner.length + 1));
    packages.set(owner, skills);
  }
  return [...packages].map(([value, skills]) => ({
    kind: "package" as const,
    value,
    ...(skills.length > 0 ? { label: skills.join(", ") } : {}),
    source,
  }));
};

export const matchPackageActivation: ToolMatcher = ({
  parsedArgs,
  resultRecord,
}) => {
  if (!resultRecord) {
    const requested = strings(asRecord(parsedArgs)?.ids);
    return requested.length > 0
      ? operation(
          "package.activate",
          "activate_package",
          packageFacts(requested, "args"),
        )
      : null;
  }
  if (!("activated" in resultRecord || "applied_scope" in resultRecord)) {
    return null;
  }
  const activated = strings(resultRecord.activated);
  const checking = activated.length === 0;
  return operation(
    checking ? "package.check" : "package.activate",
    "activate_package",
    packageFacts(checking ? strings(resultRecord.active) : activated, "result"),
  );
};
