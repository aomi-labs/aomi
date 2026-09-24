import {
  amountFact,
  asRecord,
  asString,
  chainFactFromRecord,
  uniqueFacts,
} from "../normalize";
import type { ToolFact, ToolOperation } from "../types";

export const validResult = (
  result: Record<string, unknown> | null,
): result is Record<string, unknown> =>
  !!result && result.is_error !== true && !result.error;

export const displayedAmount = (value: unknown): ToolFact | null =>
  amountFact(asString(asRecord(value)?.display));

export const routeFact = (
  source: unknown,
  destination: unknown,
): ToolFact | null => {
  const from = chainFactFromRecord(asRecord(source));
  const to = chainFactFromRecord(asRecord(destination));
  return from && to
    ? {
        kind: "route",
        value: `${from.label} → ${to.label}`,
        source: "result",
      }
    : null;
};

export const protocolOperation = (
  rawLabel: string,
  title: string,
  kind: "prepare" | "read",
  facts: Array<ToolFact | null>,
): ToolOperation => ({
  id: kind === "prepare" ? "protocol.prepare" : "protocol.result",
  rawLabel,
  title,
  confidence: "high",
  facts: uniqueFacts(facts.filter((fact): fact is ToolFact => fact != null)),
});
