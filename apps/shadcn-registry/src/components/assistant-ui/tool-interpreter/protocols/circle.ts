import { declaredToolIdentity } from "../identity";
import { asRecord, chainFactFromRecord, statusFact } from "../normalize";
import type { ToolMatcher } from "../types";
import {
  displayedAmount,
  protocolOperation,
  routeFact,
  validResult,
} from "./shared";
import type { ProtocolAdapter } from "./types";

const definitions: Record<string, { protocol: string; title: string }> = {
  circle_gateway_prepare_deposit: {
    protocol: "circle_gateway",
    title: "Prepare Circle Gateway deposit",
  },
  circle_gateway_prepare_transfer: {
    protocol: "circle_gateway",
    title: "Prepare Circle Gateway transfer",
  },
  circle_cctp_prepare_transfer: {
    protocol: "cctp_v2",
    title: "Prepare Circle CCTP transfer",
  },
};

const matchCircle: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!validResult(resultRecord)) return null;
  const definition = definitions[declaredToolIdentity(rawLabel)];
  if (!definition || resultRecord.protocol !== definition.protocol) return null;
  const details = asRecord(resultRecord.summary) ?? resultRecord;
  const amount = displayedAmount(details.amount);
  const route = routeFact(details.source, details.destination);
  if (!amount && !route) return null;
  return protocolOperation(rawLabel, definition.title, "prepare", [
    chainFactFromRecord(details) ??
      chainFactFromRecord(asRecord(details.chain)),
    amount,
    route,
    statusFact(resultRecord.status),
  ]);
};

export const circle: ProtocolAdapter = {
  tools: Object.keys(definitions),
  match: matchCircle,
};
