import {
  amountFact,
  asRecord,
  asString,
  chainFact,
  chainFactFromRecord,
  statusFact,
  tokenFact,
  uniqueFacts,
} from "../normalize";
import {
  EVM_SELECTOR_REGISTRY,
  SHAPE_ICONS,
} from "@/components/assistant-ui/tool-registry";
import type { ToolFact, ToolMatcher, ToolOperation } from "../types";
import { validResult } from "./shared";
import type { ProtocolAdapter } from "./types";

const op = (
  id: string,
  rawLabel: string,
  facts: Array<ToolFact | null>,
  title?: string,
): ToolOperation => ({
  id,
  title,
  facts: uniqueFacts(facts.filter((fact): fact is ToolFact => fact != null)),
  confidence: "high",
  rawLabel,
});

const displayAmount = (value: unknown): string | undefined =>
  asString(asRecord(value)?.display);

const amountDisplayFact = (
  value: unknown,
  role: "primary" | "secondary",
): ToolFact | null => {
  const fact = amountFact(displayAmount(value));
  return fact ? { ...fact, role } : null;
};

const amountTextFact = (
  value: unknown,
  role: "primary" | "secondary",
): ToolFact | null => {
  const fact = amountFact(asString(value));
  return fact ? { ...fact, role } : null;
};

const tokenSymbol = (value: unknown): string | undefined =>
  asString(asRecord(value)?.symbol);

const tokenPairFact = (
  fromToken: unknown,
  toToken: unknown,
): ToolFact | null => {
  const fromSymbol = tokenSymbol(fromToken);
  const toSymbol = tokenSymbol(toToken);
  if (!fromSymbol || !toSymbol) return null;
  return {
    kind: "token",
    role: "primary",
    value: `${fromSymbol} -> ${toSymbol}`,
    source: "result",
  };
};

const isBridgeRoute = (
  result: Record<string, unknown> | null | undefined,
  args?: Record<string, unknown> | null,
): boolean => {
  const source = result?.source_chain_id ?? result?.chain_id ?? args?.chain_id;
  const destination = result?.destination_chain_id ?? args?.to_chain_id;
  return (
    source != null &&
    destination != null &&
    String(source) !== String(destination)
  );
};

const locationFact = (
  result: Record<string, unknown> | null | undefined,
  args?: Record<string, unknown> | null,
): ToolFact | null => {
  const source = result?.source_chain_id ?? result?.chain_id ?? args?.chain_id;
  const destination = result?.destination_chain_id ?? args?.to_chain_id;
  const from = chainFact(source);
  const to = chainFact(destination);
  if (from && to && from.value !== to.value) {
    return {
      kind: "route",
      value: `${from.label} → ${to.label}`,
      source: "result",
    };
  }
  return from ?? chainFactFromRecord(result);
};

export const matchLifiQuote: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!validResult(resultRecord)) return null;
  const fromToken = asRecord(resultRecord.from_token);
  const toToken = asRecord(resultRecord.to_token);
  const estimate = asRecord(resultRecord.estimate);
  if (!asString(resultRecord.quote_id) || !fromToken || !toToken || !estimate) {
    return null;
  }

  return op(
    "lifi.quote",
    rawLabel,
    [
      locationFact(resultRecord),
      amountDisplayFact(resultRecord.from_amount, "primary"),
      amountTextFact(estimate.to_amount_display, "secondary"),
      tokenPairFact(fromToken, toToken),
    ],
    isBridgeRoute(resultRecord) ? "Quote LI.FI bridge" : undefined,
  );
};

export const matchLifiApproval: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!validResult(resultRecord) || !asString(resultRecord.quote_id))
    return null;
  if (!("approval_required" in resultRecord)) return null;

  const approval = asRecord(resultRecord.approval);
  const token = asRecord(approval?.token) ?? asRecord(resultRecord.token);
  if (!token) return null;

  return op("lifi.approval", rawLabel, [
    chainFactFromRecord(resultRecord) ?? chainFactFromRecord(token),
    tokenFact(token.symbol),
    amountDisplayFact(approval?.amount, "primary"),
  ]);
};

export const matchLifiSwapPrep: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!validResult(resultRecord) || !asString(resultRecord.quote_id))
    return null;
  const stageTx = asRecord(resultRecord.stage_tx);
  if (stageTx?.kind !== "lifi_swap" && stageTx?.kind !== "lifi_bridge")
    return null;

  const estimate = asRecord(resultRecord.estimate);
  return op(
    "lifi.swap.prepare",
    rawLabel,
    [
      locationFact(resultRecord),
      amountDisplayFact(resultRecord.from_amount, "primary"),
      amountTextFact(estimate?.to_amount_display, "secondary"),
      tokenPairFact(resultRecord.from_token, resultRecord.to_token),
    ],
    isBridgeRoute(resultRecord) ? "Prepare LI.FI bridge" : undefined,
  );
};

export const matchLifiSwapBatch: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  if (resultRecord && !validResult(resultRecord)) return null;
  const args = asRecord(parsedArgs);
  const estimate = asRecord(resultRecord?.estimate);
  const fromToken = asString(args?.from_token);
  const requestedAmount = asString(args?.amount);
  const requestedDisplay =
    requestedAmount && fromToken && !fromToken.startsWith("0x")
      ? `${requestedAmount} ${fromToken}`
      : requestedAmount;

  return op(
    "lifi.swap.prepare",
    rawLabel,
    [
      locationFact(resultRecord, args),
      tokenPairFact(resultRecord?.from_token, resultRecord?.to_token),
      amountDisplayFact(resultRecord?.from_amount, "primary") ??
        amountTextFact(requestedDisplay, "primary"),
      amountTextFact(estimate?.to_amount_display, "secondary"),
    ],
    isBridgeRoute(resultRecord, args) ? "Prepare LI.FI bridge" : undefined,
  );
};

export const matchLifiStatus: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!validResult(resultRecord) || !asString(resultRecord.commit_id))
    return null;
  return op("lifi.bridge.status", rawLabel, [
    locationFact(resultRecord),
    statusFact(resultRecord.state),
  ]);
};

export const lifi: ProtocolAdapter = {
  descriptors: {
    "lifi.approval": {
      title: "fixed",
      fixedTitle: "Prepare LI.FI approval",
      icon: EVM_SELECTOR_REGISTRY["0x095ea7b3"].icon,
      chipPlan: [
        { kind: "chain" },
        { kind: "token" },
        { kind: "amount", role: "primary" },
      ],
    },
    "lifi.quote": {
      title: "fixed",
      fixedTitle: "Quote LI.FI swap",
      icon: SHAPE_ICONS.swap,
      chipPlan: [
        { kind: "route" },
        { kind: "chain" },
        { kind: "token", role: "primary" },
        { kind: "amount", role: "primary" },
        { kind: "amount", role: "secondary" },
      ],
    },
    "lifi.swap.prepare": {
      title: "fixed",
      fixedTitle: "Prepare LI.FI swap",
      icon: SHAPE_ICONS.swap,
      chipPlan: [
        { kind: "route" },
        { kind: "chain" },
        { kind: "token", role: "primary" },
        { kind: "amount", role: "primary" },
        { kind: "amount", role: "secondary" },
      ],
    },
    "lifi.bridge.status": {
      title: "fixed",
      fixedTitle: "Check LI.FI transfer",
      icon: SHAPE_ICONS.swap,
      chipPlan: [{ kind: "route" }, { kind: "chain" }, { kind: "status" }],
    },
  },
  tools: [
    "lifi_get_quote",
    "lifi_prepare_approval_tx",
    "lifi_prepare_swap_tx",
    "lifi_prepare_swap_batch",
    "lifi_get_status",
  ],
  match: (ctx) => {
    switch (ctx.rawLabel.toLowerCase().trim()) {
      case "lifi_get_quote":
        return matchLifiQuote(ctx);
      case "lifi_prepare_approval_tx":
        return matchLifiApproval(ctx);
      case "lifi_prepare_swap_batch":
        return matchLifiSwapBatch(ctx);
      case "lifi_get_status":
        return matchLifiStatus(ctx);
      default:
        return matchLifiSwapPrep(ctx);
    }
  },
};
