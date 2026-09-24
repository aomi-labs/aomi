import { chainFact } from "../../normalize";
import type { ToolMatcher } from "../../types";
import { operation } from "../operation";

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
