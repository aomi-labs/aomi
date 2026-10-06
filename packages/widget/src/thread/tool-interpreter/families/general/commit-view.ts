import { asRecord, asString, statusFact } from "../../normalize";
import type { ToolFact } from "../../types";

export const commitViews = (
  result: Record<string, unknown> | null,
): Record<string, unknown>[] =>
  Array.isArray(result?.commits)
    ? result.commits
        .map(asRecord)
        .filter((view): view is Record<string, unknown> => view != null)
    : [];

export const commitStateFact = (
  views: Record<string, unknown>[],
): ToolFact | null => {
  if (views.length === 0) return null;
  const states = views.map((view) => asString(view.state));
  for (const state of ["failed", "rejected", "expired"]) {
    if (states.includes(state)) return statusFact(state);
  }
  if (states.every((state) => state === "confirmed"))
    return statusFact("confirmed");
  for (const state of ["needs_signature", "awaiting_broadcast", "submitted"]) {
    if (states.includes(state)) return statusFact(state);
  }
  return null;
};

export const commitCountFact = (
  views: Record<string, unknown>[],
): ToolFact | null => {
  if (views.length === 0) return null;
  const confirmed = views.filter((view) => view.state === "confirmed").length;
  return {
    kind: "count",
    role: "tx",
    value: String(views.length),
    label:
      confirmed > 0 && confirmed < views.length
        ? `${confirmed}/${views.length} confirmed`
        : undefined,
    source: "result",
  };
};
