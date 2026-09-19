import { asRecord } from "./normalize";
import type { ToolContext, ToolStepInput } from "./types";

const parseArgsText = (argsText?: string): unknown => {
  if (!argsText || argsText === "undefined") return undefined;
  try {
    return JSON.parse(argsText);
  } catch {
    return undefined;
  }
};

const unwrapEnvelope = (value: unknown): unknown => {
  const record = asRecord(value);
  if (!record) return value;
  if (record.is_error === true || "error" in record) return value;

  if ("__aomi_tool_value" in record) {
    return unwrapEnvelope(record.__aomi_tool_value);
  }
  if ("__aomi_tool_return" in record) {
    return unwrapEnvelope(record.__aomi_tool_return);
  }
  if ("__aomi_tool_routes" in record && "value" in record) {
    return unwrapEnvelope(record.value);
  }
  if ("RoutedToolReturn" in record && "value" in record) {
    return unwrapEnvelope(record.value);
  }

  return value;
};

export const unwrapToolStep = ({
  toolName,
  argsText,
  result,
  relatedResults,
}: ToolStepInput): ToolContext => {
  const parsedArgs = parseArgsText(argsText);
  const unwrapped =
    typeof result === "string" ? { args: result } : unwrapEnvelope(result);
  const relatedResultRecords = (relatedResults ?? [])
    .map(unwrapEnvelope)
    .map(asRecord)
    .filter((record): record is Record<string, unknown> => record !== null);

  return {
    rawLabel: toolName,
    parsedArgs,
    result: unwrapped,
    resultRecord: asRecord(unwrapped),
    relatedResultRecords,
  };
};
