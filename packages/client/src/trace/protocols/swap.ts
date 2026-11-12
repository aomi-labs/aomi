import { asRecord, asString, statusFact } from "../normalize";
import { SHAPE_ICONS } from "../registry";
import type { ToolFact, ToolMatcher } from "../types";
import { failedFact, operation } from "../families/operation";
import {
  amountDisplayFact,
  amountTextFact,
  deliveredFact,
  locationFact,
  requestedTokenLabel,
  tokenPairFact,
  tokenSymbol,
} from "./lifi";
import { validResult } from "./protocol-adapter";
import type { ProtocolAdapter } from "./protocol-adapter";

const stagedFacts = (
  parsedArgs: unknown,
  resultRecord: Record<string, unknown> | null,
): (ToolFact | null)[] => {
  const result = validResult(resultRecord) ? resultRecord : null;
  const args = asRecord(parsedArgs);
  const estimate = asRecord(result?.estimate);
  const fromToken =
    tokenSymbol(result?.from_token) ?? requestedTokenLabel(args?.from_token);
  const toToken =
    tokenSymbol(result?.to_token) ?? requestedTokenLabel(args?.to_token);
  const requested = asString(args?.amount);
  return [
    locationFact(result, args),
    tokenPairFact({ symbol: fromToken }, { symbol: toToken }),
    amountDisplayFact(result?.from_amount, "primary") ??
      amountTextFact(
        requested && fromToken ? `${requested} ${fromToken}` : requested,
        "primary",
      ),
    amountTextFact(estimate?.to_amount_display, "secondary"),
    failedFact(resultRecord),
  ];
};

const match: ToolMatcher = ({ rawLabel, parsedArgs, resultRecord }) => {
  const name = rawLabel.toLowerCase().trim();
  if (name === "bridge_status") {
    const result = validResult(resultRecord) ? resultRecord : null;
    return operation("bridge.status", rawLabel, [
      locationFact(result, asRecord(parsedArgs)),
      statusFact(result?.state),
      result?.state === "completed" ? deliveredFact(result) : null,
      failedFact(resultRecord),
    ]);
  }
  const id = {
    swap_quote: "swap.quote",
    stage_swap: "swap.stage",
    bridge_quote: "bridge.quote",
  }[name] ?? "bridge.stage";
  return operation(id, rawLabel, stagedFacts(parsedArgs, resultRecord));
};

const routeChips = [
  { kind: "route" },
  { kind: "chain" },
  { kind: "token", role: "primary" },
  { kind: "amount", role: "primary" },
  { kind: "amount", role: "secondary" },
] as const;

/** The provider-neutral swap and bridge tools; titles never name a provider. */
export const swap: ProtocolAdapter = {
  descriptors: {
    "swap.quote": {
      title: "fixed",
      fixedTitle: "Quote swap",
      icon: SHAPE_ICONS.swap,
      chipPlan: [...routeChips, { kind: "status" }],
    },
    "swap.stage": {
      title: "fixed",
      fixedTitle: "Stage swap",
      icon: SHAPE_ICONS.swap,
      chipPlan: [...routeChips, { kind: "count" }, { kind: "status" }],
    },
    "bridge.quote": {
      title: "fixed",
      fixedTitle: "Quote bridge",
      icon: "bridge",
      chipPlan: [...routeChips, { kind: "status" }],
    },
    "bridge.stage": {
      title: "fixed",
      fixedTitle: "Stage bridge",
      icon: "bridge",
      chipPlan: [...routeChips, { kind: "count" }, { kind: "status" }],
    },
    "bridge.status": {
      title: "fixed",
      fixedTitle: "Check bridge",
      icon: "bridge",
      chipPlan: [
        { kind: "route" },
        { kind: "chain" },
        { kind: "status" },
        { kind: "amount", role: "primary" },
      ],
    },
  },
  tools: ["swap_quote", "stage_swap", "bridge_quote", "stage_bridge", "bridge_status"],
  match,
};
