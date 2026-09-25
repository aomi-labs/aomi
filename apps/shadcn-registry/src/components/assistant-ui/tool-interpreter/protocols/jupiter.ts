import { amountFact, asRecord, asString, uniqueFacts } from "../normalize";
import { SHAPE_ICONS } from "@/components/assistant-ui/tool-registry";
import type { ToolFact, ToolMatcher } from "../types";
import { svmClusterFact } from "../families/svm/context";
import { validResult } from "./shared";
import type { ProtocolAdapter } from "./types";

const amountDisplayFact = (
  value: unknown,
  role: "primary" | "secondary",
): ToolFact | null => {
  const display = asString(asRecord(value)?.display);
  const fact = amountFact(display);
  return fact ? { ...fact, role } : null;
};

const tokenPairFact = (quote: Record<string, unknown>): ToolFact | null => {
  const input = asRecord(quote.input_token);
  const output = asRecord(quote.output_token);
  const inputSymbol = asString(input?.symbol);
  const outputSymbol = asString(output?.symbol);
  if (!inputSymbol || !outputSymbol) return null;
  return {
    kind: "token",
    role: "primary",
    value: `${inputSymbol} -> ${outputSymbol}`,
    label: `${inputSymbol} → ${outputSymbol}`,
    source: "result",
  };
};

export const matchJupiterSwapPrep: ToolMatcher = ({
  rawLabel,
  resultRecord,
}) => {
  if (!validResult(resultRecord)) return null;
  const quote = asRecord(resultRecord.quote);
  if (!quote || !asRecord(quote.input_token) || !asRecord(quote.output_token)) {
    return null;
  }
  if (!("ix_ids" in resultRecord || "instruction_count" in resultRecord)) {
    return null;
  }

  const facts = [
    svmClusterFact(resultRecord.cluster),
    amountDisplayFact(quote.input, "primary"),
    amountDisplayFact(quote.expected_output, "secondary"),
    tokenPairFact(quote),
  ].filter((fact): fact is ToolFact => fact != null);

  return {
    id: "jupiter.swap.prepare",
    facts: uniqueFacts(facts),
    confidence: "high",
    rawLabel,
  };
};

export const jupiter: ProtocolAdapter = {
  descriptors: {
    "jupiter.swap.prepare": {
      title: "fixed",
      fixedTitle: "Prepare swap",
      icon: SHAPE_ICONS.swap,
      chipPlan: [
        { kind: "cluster" },
        { kind: "token", role: "primary" },
        { kind: "amount", role: "primary" },
        { kind: "amount", role: "secondary" },
      ],
    },
  },
  tools: ["jupiter_prepare_swap"],
  match: matchJupiterSwapPrep,
};
