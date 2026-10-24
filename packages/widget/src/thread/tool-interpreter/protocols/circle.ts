import { declaredToolIdentity } from "@/thread/tool-interpreter/identity";
import {
  asRecord,
  chainFactFromRecord,
  statusFact,
} from "@/thread/tool-interpreter/normalize";
import type { ToolMatcher } from "@/thread/tool-interpreter/types";
import {
  displayedAmount,
  protocolOperation,
  routeFact,
  validResult,
} from "@/thread/tool-interpreter/protocols/protocol-adapter";
import type { ProtocolAdapter } from "@/thread/tool-interpreter/protocols/protocol-adapter";

const definitions: Record<string, { protocol: string; title: string }> = {
  stage_circle_gateway_deposit: {
    protocol: "circle_gateway",
    title: "Stage Circle Gateway deposit",
  },
  // Retired name, still in saved threads.
  circle_gateway_prepare_deposit: {
    protocol: "circle_gateway",
    title: "Stage Circle Gateway deposit",
  },
  circle_gateway_prepare_transfer: {
    protocol: "circle_gateway",
    title: "Prepare Circle Gateway transfer",
  },
  stage_cctp_transfer: {
    protocol: "cctp_v2",
    title: "Stage Circle CCTP transfer",
  },
  // Retired name, still in saved threads.
  circle_cctp_prepare_transfer: {
    protocol: "cctp_v2",
    title: "Stage Circle CCTP transfer",
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
