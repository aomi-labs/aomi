import {
  type ToolMatcher,
  type ToolFact,
  type ToolOperation,
} from "@/thread/tool-interpreter/types";
import { type Descriptor } from "@/thread/tool-interpreter/present/descriptors";
import {
  amountFact,
  asRecord,
  asString,
  chainFactFromRecord,
  uniqueFacts,
} from "@/thread/tool-interpreter/normalize";
import { isErrorResult } from "@/thread/tool-interpreter/families/operation";

/** Each protocol owns its declared tool names and result interpretation. */
export type ProtocolAdapter = {
  tools: readonly string[];
  match: ToolMatcher;
  descriptors?: Record<string, Descriptor>;
};

export const validResult = (
  result: Record<string, unknown> | null,
): result is Record<string, unknown> => !!result && !isErrorResult(result);

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
