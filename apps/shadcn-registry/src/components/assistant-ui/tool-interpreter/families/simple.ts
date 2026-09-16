import {
  addressFact,
  amountFact,
  asRecord,
  asString,
  chainFact,
  chainFactFromRecord,
  hostnameFromUrl,
  statusFact,
  tokenFact,
  topicTokenFact,
  uniqueFacts,
} from "../normalize";
import type { ToolFact, ToolMatcher, ToolOperation } from "../types";

const op = (
  id: string,
  rawLabel: string,
  facts: Array<ToolFact | null>,
  confidence: ToolOperation["confidence"] = "high",
): ToolOperation => ({
  id,
  facts: uniqueFacts(facts.filter((fact): fact is ToolFact => fact != null)),
  confidence,
  rawLabel,
});

const displaySkillLabel = (skillId: string): string | undefined => {
  if (skillId === "lifi_swap") return "Lifi";
  return undefined;
};

export const matchWebSearch: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord) return null;
  const body = asString(resultRecord.args) ?? asString(resultRecord.result);
  if (!body || !/Found\s+\d+\s+results/i.test(body)) return null;

  const count = body.match(/Found\s+(\d+)\s+results/i)?.[1];
  const firstUrl = body.match(/URL:\s*(https?:\/\/\S+)/i)?.[1];
  const source = firstUrl ? hostnameFromUrl(firstUrl) : null;

  return op("web.search", rawLabel, [
    topicTokenFact(rawLabel),
    count
      ? { kind: "count", role: "results", value: count, source: "result" }
      : null,
    source ? { kind: "sourceHost", value: source, source: "result" } : null,
  ]);
};

export const matchSkillActivation: ToolMatcher = ({
  rawLabel,
  resultRecord,
}) => {
  if (!resultRecord) return null;
  if (!("activated" in resultRecord || "applied_scope" in resultRecord)) {
    return null;
  }

  const activated = Array.isArray(resultRecord.activated)
    ? resultRecord.activated.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  return op(
    "skill.activate",
    rawLabel,
    activated.length > 0
      ? activated.map((value) => ({
          kind: "skill",
          value,
          label: displaySkillLabel(value),
          source: "result" as const,
        }))
      : [{ kind: "skill", value: "Skill", source: "result" }],
  );
};

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

  return op("evm.context", rawLabel, [
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

export const matchNativeBalance: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord) return null;
  const address = addressFact(resultRecord.address, "owner");
  const balance = amountFact(resultRecord.balance_eth, "ETH");
  if (!address || !balance) return null;

  return op("evm.account.native_balance", rawLabel, [
    chainFactFromRecord(resultRecord),
    address,
    { ...balance, role: "native" },
  ]);
};

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

  return op(`evm.contract.lookup.${found ? "found" : "missing"}`, rawLabel, [
    chainFactFromRecord(first) ?? chainFactFromRecord(resultRecord),
    tokenFact(first?.symbol) ?? topicTokenFact(rawLabel),
  ]);
};

export const matchError: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord) return null;
  const rawError = resultRecord.error;
  if (!(resultRecord.is_error === true || rawError)) return null;
  const errorRecord = asRecord(rawError);
  const code =
    asString(resultRecord.code) ??
    asString(errorRecord?.code) ??
    asString(errorRecord?.type);

  return op("tool.error", rawLabel, [
    statusFact("failed"),
    code
      ? { kind: "code", role: "error", value: code, source: "result" }
      : null,
  ]);
};
