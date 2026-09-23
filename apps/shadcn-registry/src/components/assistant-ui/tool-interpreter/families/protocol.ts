import {
  amountFact,
  asRecord,
  asString,
  chainFactFromRecord,
  humanize,
  statusFact,
  uniqueFacts,
} from "../normalize";
import { toolIdentity } from "../identity";
import type { ToolFact, ToolMatcher, ToolOperation } from "../types";

type ProtocolTool = {
  protocol?: string;
  label: string;
  title: string;
  kind: "prepare" | "read";
};

/** Only declared integrations can receive protocol presentation. */
const protocolTools: Record<string, ProtocolTool> = {
  aave_v4_prepare: {
    protocol: "aave_v4",
    label: "Aave V4",
    title: "Prepare operation",
    kind: "prepare",
  },
  aave_v4_markets: {
    protocol: "aave_v4",
    label: "Aave V4",
    title: "Read markets",
    kind: "read",
  },
  aave_v4_positions: {
    protocol: "aave_v4",
    label: "Aave V4",
    title: "Read positions",
    kind: "read",
  },
  morpho_find_vaults: { label: "Morpho", title: "Find vaults", kind: "read" },
  morpho_vault_overview: { label: "Morpho", title: "Read vault", kind: "read" },
  morpho_vault_allocations: {
    label: "Morpho",
    title: "Read vault allocations",
    kind: "read",
  },
  morpho_vault_history: {
    label: "Morpho",
    title: "Read vault history",
    kind: "read",
  },
  morpho_vault_governance: {
    label: "Morpho",
    title: "Read vault governance",
    kind: "read",
  },
  morpho_user_vault_positions: {
    label: "Morpho",
    title: "Read vault positions",
    kind: "read",
  },
  aerodrome_arc_prepare_swap: {
    protocol: "aerodrome",
    label: "Aerodrome",
    title: "Prepare swap",
    kind: "prepare",
  },
  uniswap_v4_quote: {
    protocol: "uniswap_v4",
    label: "Uniswap V4",
    title: "Quote swap",
    kind: "read",
  },
  uniswap_v4_swap: {
    protocol: "uniswap_v4",
    label: "Uniswap V4",
    title: "Prepare swap",
    kind: "prepare",
  },
  uniswap_v4_exact_out_swap: {
    protocol: "uniswap_v4",
    label: "Uniswap V4",
    title: "Prepare swap",
    kind: "prepare",
  },
  uniswap_v4_pool_info: {
    protocol: "uniswap_v4",
    label: "Uniswap V4",
    title: "Read pool",
    kind: "read",
  },
  uniswap_v4_discover_pools: {
    protocol: "uniswap_v4",
    label: "Uniswap V4",
    title: "Find pools",
    kind: "read",
  },
  circle_gateway_prepare_deposit: {
    protocol: "circle_gateway",
    label: "Circle Gateway",
    title: "Prepare deposit",
    kind: "prepare",
  },
  circle_gateway_prepare_transfer: {
    protocol: "circle_gateway",
    label: "Circle Gateway",
    title: "Prepare transfer",
    kind: "prepare",
  },
  circle_cctp_prepare_transfer: {
    protocol: "cctp_v2",
    label: "Circle CCTP",
    title: "Prepare transfer",
    kind: "prepare",
  },
};

export const isSupportedProtocolTool = (name: string): boolean =>
  Object.hasOwn(protocolTools, name);

const routeFact = (details: Record<string, unknown>): ToolFact | null => {
  const source = chainFactFromRecord(asRecord(details.source));
  const destination = chainFactFromRecord(asRecord(details.destination));
  return source && destination
    ? {
        kind: "decoded",
        value: `${source.label} → ${destination.label}`,
        source: "result",
      }
    : null;
};

export const matchProtocol: ToolMatcher = ({ rawLabel, resultRecord }) => {
  const name = toolIdentity(rawLabel);
  const definition = isSupportedProtocolTool(name) ? protocolTools[name] : null;
  if (!definition || !resultRecord) return null;
  if (resultRecord.is_error === true || resultRecord.error) return null;
  if (definition.protocol && resultRecord.protocol !== definition.protocol)
    return null;
  if (name.startsWith("morpho_") && resultRecord.source !== "morpho")
    return null;
  const details = asRecord(resultRecord.summary) ?? resultRecord;
  const amount = asString(asRecord(details.amount)?.display);
  const operation = asString(resultRecord.operation);
  if (
    definition.kind === "prepare" &&
    !amount &&
    !operation &&
    !routeFact(details)
  )
    return null;
  const vault = asRecord(details.vault);
  const chain =
    chainFactFromRecord(details) ??
    chainFactFromRecord(asRecord(details.chain)) ??
    chainFactFromRecord(vault);
  const title =
    toolIdentity(rawLabel) === "aave_v4_prepare" &&
    operation &&
    [
      "supply",
      "withdraw",
      "borrow",
      "repay",
      "enable_collateral",
      "disable_collateral",
    ].includes(operation)
      ? `Prepare Aave V4 ${humanize(operation).toLowerCase()}`
      : `${definition.title} ${definition.label}`;
  const facts: Array<ToolFact | null> = [
    chain,
    amount ? amountFact(amount) : null,
    asRecord(resultRecord.approval)?.required === true &&
    definition.kind === "prepare"
      ? { kind: "decoded", value: "Approval required", source: "result" }
      : (routeFact(details) ??
        (vault && asString(vault.name)
          ? { kind: "decoded", value: asString(vault.name)!, source: "result" }
          : null)),
    definition.kind === "read"
      ? { kind: "sourceHost", value: definition.label, source: "result" }
      : null,
    statusFact(resultRecord.status),
  ];
  return {
    id: definition.kind === "prepare" ? "protocol.prepare" : "protocol.result",
    rawLabel,
    title,
    confidence: "high",
    facts: uniqueFacts(facts.filter((fact): fact is ToolFact => fact != null)),
  } satisfies ToolOperation;
};
