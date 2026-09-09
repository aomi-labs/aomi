import { humanize } from "../normalize";
import type { InterpretedToolStep, ToolFact, ToolOperation } from "../types";
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

const CHIP_KIND_ORDER: Record<ToolFact["kind"], number> = {
  chain: 0,
  cluster: 0,
  action: 1,
  token: 1,
  skill: 1,
  sourceHost: 1,
  selector: 1,
  address: 2,
  amount: 3,
  block: 3,
  code: 3,
  count: 3,
  decoded: 3,
  gas: 3,
  slot: 3,
  txId: 3,
  status: 4,
};

const canonicalFactOrder = (facts: ToolFact[]): ToolFact[] =>
  facts
    .map((fact, index) => ({ fact, index }))
    .sort(
      (left, right) =>
        CHIP_KIND_ORDER[left.fact.kind] - CHIP_KIND_ORDER[right.fact.kind] ||
        left.index - right.index,
    )
    .map(({ fact }) => fact);

/** A failure/error status fact — the same signal that renders the "Failed" chip. */
const isFailedStatus = (fact: ToolFact): boolean =>
  fact.kind === "status" && (fact.value === "failed" || fact.value === "error");

export const presentOperation = (
  operation: ToolOperation,
): InterpretedToolStep => {
  const descriptor = descriptorFor(operation);
  const title =
    operation.title ??
    (descriptor.title === "fixed"
      ? (descriptor.fixedTitle ?? humanize(operation.rawLabel))
      : humanize(operation.rawLabel));
  const chips = uniqueChips(
    canonicalFactOrder(pickFacts(operation.facts, descriptor.chipPlan))
      .map(chipForFact)
      .filter((chip): chip is NonNullable<typeof chip> => chip != null),
  );

  return {
    icon: iconForDescriptor(descriptor, operation),
    title,
    chips,
    confidence: operation.confidence,
    rawLabel: operation.rawLabel,
    failed: operation.failed ?? operation.facts.some(isFailedStatus),
  };
};
