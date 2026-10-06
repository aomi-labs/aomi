import { declaredToolIdentity } from "../identity";
import { asRecord, chainFactFromRecord, statusFact } from "../normalize";
import type { ToolMatcher } from "../types";
import { displayedAmount, protocolOperation, validResult } from "./shared";
import type { ProtocolAdapter } from "./types";

const titles: Record<string, { title: string; kind: "read" | "prepare" }> = {
  uniswap_v4_quote: { title: "Quote Uniswap V4 swap", kind: "read" },
  uniswap_v4_swap: { title: "Prepare Uniswap V4 swap", kind: "prepare" },
  uniswap_v4_exact_out_swap: {
    title: "Prepare Uniswap V4 swap",
    kind: "prepare",
  },
  uniswap_v4_pool_info: { title: "Read Uniswap V4 pool", kind: "read" },
  uniswap_v4_discover_pools: { title: "Find Uniswap V4 pools", kind: "read" },
};

const matchUniswap: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!validResult(resultRecord) || resultRecord.protocol !== "uniswap_v4")
    return null;
  const definition = titles[declaredToolIdentity(rawLabel)];
  if (!definition) return null;
  const details = asRecord(resultRecord.summary) ?? resultRecord;
  const amount = displayedAmount(details.amount);
  if (definition.kind === "prepare" && !amount) return null;
  return protocolOperation(rawLabel, definition.title, definition.kind, [
    chainFactFromRecord(details),
    amount,
    statusFact(resultRecord.status),
  ]);
};

export const uniswap: ProtocolAdapter = {
  tools: Object.keys(titles),
  match: matchUniswap,
};
