import {
  asInteger,
  asRecord,
  chainFact,
  chainFactFromRecord,
} from "../../normalize";
import type { ToolMatcher } from "../../types";
import { isErrorResult, operation } from "../operation";

export const matchChainContext: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord) return null;
  if (
    !(
      "supported_chains" in resultRecord ||
      "rpc_endpoint" in resultRecord ||
      "block_number" in resultRecord
    )
  ) {
    return null;
  }

  return operation("evm.context", rawLabel, [
    chainFact(resultRecord.chain_id, resultRecord.chain_name),
    typeof resultRecord.block_number === "number"
      ? {
          kind: "block",
          value: String(resultRecord.block_number),
          source: "result",
        }
      : null,
  ]);
};

export const matchSyncChain: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  if (isErrorResult(resultRecord)) return null;
  const args = asRecord(parsedArgs);
  const chain =
    chainFactFromRecord(resultRecord) ?? chainFactFromRecord(args, "args");
  const block = asInteger(resultRecord?.block_number);
  if (!chain && block == null) return null;

  return operation("evm.context", rawLabel, [
    chain,
    block != null
      ? { kind: "block", value: String(block), source: "result" }
      : null,
  ]);
};
