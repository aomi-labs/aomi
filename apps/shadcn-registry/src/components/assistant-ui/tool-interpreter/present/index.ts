import { humanize } from "../normalize";
import { toolIdentity } from "../identity";
import type {
  InterpretedToolStep,
  ToolFact,
  ToolOperation,
  ToolOutcome,
} from "../types";
import { chipForFact, uniqueChips } from "./chips";
import { descriptorFor, iconForDescriptor } from "./descriptors";

const pickFacts = (
  facts: ToolFact[],
  slots: ReturnType<typeof descriptorFor>["chipPlan"],
): ToolFact[] => {
  const picked: ToolFact[] = [];
  const used = new Set<ToolFact>();

  for (const slot of slots) {
    const matches = facts.filter(
      (fact) =>
        fact.kind === slot.kind &&
        (slot.role == null || fact.role === slot.role) &&
        !used.has(fact),
    );
    const selected = slot.repeat ? matches : matches.slice(0, 1);
    selected.forEach((fact) => {
      picked.push(fact);
      used.add(fact);
    });
  }

  return picked;
};

/** A failure/error status fact — the same signal that renders the "Failed" chip. */
const isFailedStatus = (fact: ToolFact): boolean =>
  fact.kind === "status" && ["failed", "error"].includes(fact.value);

const outcomeFor = (operation: ToolOperation): ToolOutcome => {
  if (operation.failed) return "failed";
  const status = operation.facts.find((fact) => fact.kind === "status")?.value;
  if (status === "failed" || status === "error") return "failed";
  if (status === "rejected" || status === "expired" || status === "revoked")
    return "cancelled";
  if (status === "incomplete") return "incomplete";
  if (
    status === "pending" ||
    status === "pending_approval" ||
    status === "needs_signature" ||
    status === "awaiting_broadcast" ||
    status === "submitted"
  )
    return "waiting";
  if (
    status &&
    [
      "queued",
      "staged",
      "passed",
      "confirmed",
      "prepared",
      "success",
      "complete",
    ].includes(status)
  )
    return "success";
  if (status || operation.id.includes(".tx.")) return "unknown";
  return "success";
};

export const presentOperation = (
  operation: ToolOperation,
): InterpretedToolStep => {
  const descriptor = descriptorFor(operation);
  const readableLabel = operation.rawLabel.includes("::")
    ? humanize(toolIdentity(operation.rawLabel))
    : humanize(operation.rawLabel);
  const title =
    operation.title ??
    (descriptor.title === "fixed"
      ? (descriptor.fixedTitle ?? readableLabel)
      : readableLabel);
  const lifecycle = operation.id.includes(".tx.");
  const chips = uniqueChips(
    pickFacts(operation.facts, descriptor.chipPlan)
      .map((fact) => {
        const chip = chipForFact(fact);
        return chip
          ? {
              ...chip,
              key: `${fact.kind}:${fact.role ?? ""}:${fact.value}`,
              essential:
                lifecycle &&
                (["chain", "cluster", "count", "status"] as string[]).includes(
                  fact.kind,
                ),
            }
          : null;
      })
      .filter((chip): chip is NonNullable<typeof chip> => chip != null),
  );

  return {
    icon: iconForDescriptor(descriptor, operation),
    title,
    chips,
    confidence: operation.confidence,
    rawLabel: operation.rawLabel,
    failed: operation.failed ?? operation.facts.some(isFailedStatus),
    outcome: outcomeFor(operation),
  };
};
