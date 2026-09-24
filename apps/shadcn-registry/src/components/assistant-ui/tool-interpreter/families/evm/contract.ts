import { asRecord, chainFactFromRecord, tokenFact } from "../../normalize";
import type { ToolMatcher } from "../../types";
import { operation } from "../operation";

export const matchTokenLookup: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord) return null;
  if (!("found" in resultRecord && "contracts" in resultRecord)) return null;

  const contracts = Array.isArray(resultRecord.contracts)
    ? resultRecord.contracts
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => !!item)
    : [];
  const first = contracts[0];
  const found = resultRecord.found === true;

  return operation(
    `evm.contract.lookup.${found ? "found" : "missing"}`,
    rawLabel,
    [
      chainFactFromRecord(first) ?? chainFactFromRecord(resultRecord),
      tokenFact(first?.symbol),
    ],
  );
};
