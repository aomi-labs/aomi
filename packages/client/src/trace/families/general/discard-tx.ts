import type { ToolMatcher } from "../../types";
import { failedFact, operation } from "../operation";

/** Only returned ids count as discarded; requested ids may have been refused. */
export const matchDiscardTx: ToolMatcher = ({ rawLabel, resultRecord }) => {
  const failed = failedFact(resultRecord);
  const discarded = Array.isArray(resultRecord?.discarded)
    ? resultRecord.discarded
    : undefined;
  const count = discarded
    ? new Set(discarded.filter((id) => Number.isSafeInteger(id) && id >= 0))
        .size
    : undefined;
  return operation("general.tx.discard", rawLabel, [
    !failed && count != null
      ? {
          kind: "count",
          role: "tx",
          value: String(count),
          label: `${count} tx${count === 1 ? "" : "s"} discarded`,
          source: "result",
        }
      : null,
    failed ??
      (count != null
        ? { kind: "status", value: "success", source: "result" }
        : null),
  ]);
};
