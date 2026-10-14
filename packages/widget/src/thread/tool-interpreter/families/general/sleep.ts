import { asRecord } from "@/thread/tool-interpreter/normalize";
import type { ToolMatcher } from "@/thread/tool-interpreter/types";
import { isErrorResult, operation } from "@/thread/tool-interpreter/families/operation";

export const matchSleep: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  if (isErrorResult(resultRecord)) return null;
  const requested = asRecord(parsedArgs)?.seconds;
  const elapsed = resultRecord?.slept_seconds;
  const seconds =
    typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed > 0
      ? elapsed
      : requested;

  return operation(
    "tool.sleep",
    rawLabel,
    typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
      ? [
          {
            kind: "requirement",
            value: String(seconds),
            label: `${seconds} sec`,
            source: typeof elapsed === "number" ? "result" : "args",
          },
        ]
      : [],
  );
};
