import { asRecord, chainFactFromRecord, statusFact } from "../normalize";
import type { ToolMatcher } from "../types";
import {
  displayedAmount,
  protocolOperation,
  validResult,
} from "./protocol-adapter";
import type { ProtocolAdapter } from "./protocol-adapter";

const matchAerodrome: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!validResult(resultRecord) || resultRecord.protocol !== "aerodrome")
    return null;
  const details = asRecord(resultRecord.summary) ?? resultRecord;
  const amount = displayedAmount(details.amount);
  if (!amount) return null;
  return protocolOperation(rawLabel, "Stage Aerodrome swap", "prepare", [
    chainFactFromRecord(details),
    amount,
    statusFact(resultRecord.status),
  ]);
};

export const aerodrome: ProtocolAdapter = {
  // `aerodrome_arc_prepare_swap` is the retired name, still in saved threads.
  tools: ["stage_aerodrome_swap", "aerodrome_arc_prepare_swap"],
  match: matchAerodrome,
};
