import { uniqueFacts } from "../normalize";
import type { ToolFact, ToolOperation } from "../types";

export const operation = (
  id: string,
  rawLabel: string,
  facts: Array<ToolFact | null>,
): ToolOperation => ({
  id,
  facts: uniqueFacts(facts.filter((fact): fact is ToolFact => fact != null)),
  confidence: "high",
  rawLabel,
});
