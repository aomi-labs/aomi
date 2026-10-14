import { asRecord, chainFactFromRecord, statusFact } from "@/thread/tool-interpreter/normalize";
import type { ToolMatcher } from "@/thread/tool-interpreter/types";
import { displayedAmount, protocolOperation, validResult } from "./shared";
import type { ProtocolAdapter } from "./types";

const matchAerodrome: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!validResult(resultRecord) || resultRecord.protocol !== "aerodrome")
    return null;
  const details = asRecord(resultRecord.summary) ?? resultRecord;
  const amount = displayedAmount(details.amount);
  if (!amount) return null;
  return protocolOperation(rawLabel, "Prepare Aerodrome swap", "prepare", [
    chainFactFromRecord(details),
    amount,
    statusFact(resultRecord.status),
  ]);
};

export const aerodrome: ProtocolAdapter = {
  tools: ["aerodrome_arc_prepare_swap"],
  match: matchAerodrome,
};
