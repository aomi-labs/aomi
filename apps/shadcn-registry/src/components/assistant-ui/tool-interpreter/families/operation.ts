import { statusFact, uniqueFacts } from "../normalize";
import type { ToolFact, ToolOperation } from "../types";

type ToolResult = Record<string, unknown> | null | undefined;

export const operation = (
  id: string,
  rawLabel: string,
  facts: Array<ToolFact | null>,
  extra?: Partial<Pick<ToolOperation, "title" | "confidence">>,
): ToolOperation => ({
  id,
  facts: uniqueFacts(facts.filter((fact): fact is ToolFact => fact != null)),
  confidence: "high",
  rawLabel,
  ...extra,
});

/** The result reports a failure, by flag or by carrying an error. */
export const isErrorResult = (result: ToolResult): boolean =>
  result?.is_error === true || Boolean(result?.error);

/** A "failed" status for an errored result, else nothing. */
export const failedFact = (result: ToolResult): ToolFact | null =>
  isErrorResult(result) ? statusFact("failed") : null;
