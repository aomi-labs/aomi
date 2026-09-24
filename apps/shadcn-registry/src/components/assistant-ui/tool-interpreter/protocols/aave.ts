import { declaredToolIdentity } from "../identity";
import {
  asRecord,
  asString,
  chainFactFromRecord,
  humanize,
  statusFact,
} from "../normalize";
import type { ToolMatcher } from "../types";
import { displayedAmount, protocolOperation, validResult } from "./shared";
import type { ProtocolAdapter } from "./types";

const readTitles: Record<string, string> = {
  aave_v4_markets: "Read Aave V4 markets",
  aave_v4_positions: "Read Aave V4 positions",
};

const matchAave: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!validResult(resultRecord) || resultRecord.protocol !== "aave_v4")
    return null;
  const name = declaredToolIdentity(rawLabel);
  const details = asRecord(resultRecord.summary) ?? resultRecord;
  const chain =
    chainFactFromRecord(details) ?? chainFactFromRecord(resultRecord);
  const status = statusFact(resultRecord.status);

  if (name !== "aave_v4_prepare") {
    const title = readTitles[name];
    return title
      ? protocolOperation(rawLabel, title, "read", [chain, status])
      : null;
  }

  const amount = displayedAmount(details.amount);
  const action = asString(resultRecord.operation);
  if (!amount && !action) return null;
  const title =
    action &&
    [
      "supply",
      "withdraw",
      "borrow",
      "repay",
      "enable_collateral",
      "disable_collateral",
    ].includes(action)
      ? `Prepare Aave V4 ${humanize(action).toLowerCase()}`
      : "Prepare operation Aave V4";
  const approval =
    asRecord(resultRecord.approval)?.required === true
      ? {
          kind: "requirement" as const,
          value: "Approval required",
          source: "result" as const,
        }
      : null;
  return protocolOperation(rawLabel, title, "prepare", [
    chain,
    amount,
    approval,
    status,
  ]);
};

export const aave: ProtocolAdapter = {
  tools: ["aave_v4_prepare", ...Object.keys(readTitles)],
  match: matchAave,
};
