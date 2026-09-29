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

const failedFact = (result: Record<string, unknown> | null): ToolFact | null =>
  result && !validResult(result) ? statusFact("failed") : null;

// Keep full precision in tool data; round only the visible trace chips.
const roundedAmount = (value: string | undefined): string | undefined => {
  if (!value) return value;
  const match = value.match(/^(\d+)(?:\.(\d+))?(.*)$/);
  if (!match) return value;
  const [, whole, fraction = "", suffix] = match;
  if (fraction.length <= 5) return value;
  const precision = BigInt(100000);
  const scaled = BigInt(whole) * precision + BigInt(fraction.slice(0, 5));
  const rounded = scaled + (fraction[5] >= "5" ? BigInt(1) : BigInt(0));
  if (rounded === BigInt(0) && /[1-9]/.test(whole + fraction)) {
    return `<0.00001${suffix}`;
  }
  const decimals = (rounded % precision)
    .toString()
    .padStart(5, "0")
    .replace(/0+$/, "");
  return `${rounded / precision}${decimals ? `.${decimals}` : ""}${suffix}`;
};

const requestedTokenLabel = (value: unknown): string | undefined => {
  const token = asString(value);
  return token?.startsWith("0x")
    ? `${token.slice(0, 6)}…${token.slice(-4)}`
    : token;
};

const displayAmount = (value: unknown): string | undefined =>
  asString(asRecord(value)?.display);

const amountDisplayFact = (
  value: unknown,
  role: "primary" | "secondary",
): ToolFact | null => {
  const fact = amountFact(roundedAmount(displayAmount(value)));
  return fact ? { ...fact, role } : null;
};

const amountTextFact = (
  value: unknown,
  role: "primary" | "secondary",
): ToolFact | null => {
  const fact = amountFact(roundedAmount(asString(value)));
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

export const matchLifiQuote: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  const result = validResult(resultRecord) ? resultRecord : null;
  const args = asRecord(parsedArgs);
  const fromToken = asRecord(result?.from_token);
  const toToken = asRecord(result?.to_token);
  const estimate = asRecord(result?.estimate);

  return op(
    "lifi.quote",
    rawLabel,
    [
      locationFact(result, args),
      amountDisplayFact(result?.from_amount, "primary"),
      amountTextFact(estimate?.to_amount_display, "secondary"),
      tokenPairFact(fromToken, toToken),
      failedFact(resultRecord),
    ],
    isBridgeRoute(result, args) ? "Quote LI.FI bridge" : undefined,
  );
};

export const matchLifiApproval: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  const result = validResult(resultRecord) ? resultRecord : null;
  const args = asRecord(parsedArgs);
  const approval = asRecord(result?.approval);
  const token = asRecord(approval?.token) ?? asRecord(result?.token);

  return op("lifi.approval", rawLabel, [
    chainFactFromRecord(result) ??
      chainFactFromRecord(token) ??
      chainFactFromRecord(args),
    tokenFact(token?.symbol),
    amountDisplayFact(approval?.amount, "primary"),
    failedFact(resultRecord),
  ]);
};

export const matchLifiSwapPrep: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  const result = validResult(resultRecord) ? resultRecord : null;
  const args = asRecord(parsedArgs);
  const estimate = asRecord(result?.estimate);
  return op(
    "lifi.swap.prepare",
    rawLabel,
    [
      locationFact(result, args),
      amountDisplayFact(result?.from_amount, "primary"),
      amountTextFact(estimate?.to_amount_display, "secondary"),
      tokenPairFact(result?.from_token, result?.to_token),
      failedFact(resultRecord),
    ],
    isBridgeRoute(result, args) ? "Prepare LI.FI bridge" : undefined,
  );
};

export const matchLifiSwapBatch: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  const result = validResult(resultRecord) ? resultRecord : null;
  const args = asRecord(parsedArgs);
  const estimate = asRecord(result?.estimate);
  const fromToken =
    tokenSymbol(result?.from_token) ?? requestedTokenLabel(args?.from_token);
  const toToken =
    tokenSymbol(result?.to_token) ?? requestedTokenLabel(args?.to_token);
  const requestedAmount = asString(args?.amount);
  const requestedDisplay =
    requestedAmount && fromToken
      ? `${requestedAmount} ${fromToken}`
      : requestedAmount;

  return op(
    "lifi.swap.prepare",
    rawLabel,
    [
      locationFact(result, args),
      tokenPairFact(result?.from_token, result?.to_token) ??
        tokenPairFact({ symbol: fromToken }, { symbol: toToken }),
      amountDisplayFact(result?.from_amount, "primary") ??
        amountTextFact(requestedDisplay, "primary"),
      amountTextFact(estimate?.to_amount_display, "secondary"),
      failedFact(resultRecord),
    ],
    isBridgeRoute(result, args)
      ? "Prepare LI.FI bridge"
      : "Prepare LI.FI swap batch",
  );
};

export const matchLifiStatus: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  const result = validResult(resultRecord) ? resultRecord : null;
  return op("lifi.bridge.status", rawLabel, [
    locationFact(result, asRecord(parsedArgs)),
    statusFact(result?.state),
    failedFact(resultRecord),
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
        { kind: "status" },
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
        { kind: "status" },
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
        { kind: "status" },
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
