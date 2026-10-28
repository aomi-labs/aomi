import { asRecord, asString, statusFact } from "../../normalize";
import type { ToolMatcher } from "../../types";
import { isErrorResult, operation } from "../operation";

export const matchError: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord) return null;
  const rawError = resultRecord.error;
  if (!isErrorResult(resultRecord)) return null;
  const errorRecord = asRecord(rawError);
  const code =
    asString(resultRecord.code) ??
    asString(errorRecord?.code) ??
    asString(errorRecord?.type);

  return operation("tool.error", rawLabel, [
    statusFact("failed"),
    code
      ? { kind: "code", role: "error", value: code, source: "result" }
      : null,
  ]);
};
