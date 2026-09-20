import {
  amountFact,
  asRecord,
  asString,
  chainFactFromRecord,
  humanize,
  statusFact,
  tokenFact,
  uniqueFacts,
} from "../normalize";
import type { ToolFact, ToolMatcher } from "../types";

/** Protocol-owned read/preparation results; raw atomic amounts are never guessed. */
export const matchProtocol: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord) return null;
  const protocol =
    asString(resultRecord.protocol) ?? asString(resultRecord.source);
  const labels: Record<string, string> = {
    aave_v4: "Aave V4",
    aerodrome: "Aerodrome",
    uniswap_v4: "Uniswap V4",
    morpho: "Morpho",
    circle_gateway: "Circle Gateway",
    cctp_v2: "Circle CCTP",
  };
  if (!protocol || !labels[protocol]) return null;
  const details = asRecord(resultRecord.summary) ?? resultRecord;
  const vault = asRecord(details.vault);
  const spoke = asRecord(details.spoke);
  const reserve = asRecord(details.reserve);
  const amount = asRecord(details.amount);
  const token = asRecord(details.token) ?? asRecord(vault?.asset);
  const sourceChain = chainFactFromRecord(asRecord(details.source));
  const destinationChain = chainFactFromRecord(asRecord(details.destination));
  const marketName = asString(spoke?.name) ?? asString(vault?.name);
  const facts: Array<ToolFact | null> = [
    chainFactFromRecord(details) ??
      chainFactFromRecord(asRecord(details.chain)) ??
      chainFactFromRecord(vault),
    sourceChain && destinationChain
      ? {
          kind: "decoded",
          value: `${sourceChain.label} → ${destinationChain.label}`,
          source: "result",
        }
      : null,
    { kind: "sourceHost", value: labels[protocol], source: "result" },
    marketName
      ? {
          kind: "decoded",
          value: spoke ? `${humanize(marketName)} market` : marketName,
          source: "result",
        }
      : null,
    tokenFact(token?.symbol ?? reserve?.symbol),
    amountFact(amount?.display),
    statusFact(resultRecord.status),
  ];
  return {
    id: "protocol.result",
    rawLabel,
    confidence: "high",
    facts: uniqueFacts(facts.filter((fact): fact is ToolFact => fact != null)),
  };
};
