import {
  chainFact,
  asRecord,
  asString,
  topicTokenFact,
  tokenFact,
  uniqueFacts,
} from "./normalize";
import {
  matchChainContext,
  matchError,
  matchNativeBalance,
  matchSkillActivation,
  matchTokenLookup,
  matchWebSearch,
} from "./families/simple";
import {
  matchEvmPendingApproval,
  matchEvmSimulation,
  matchStagedTx,
} from "./families/evm-tx";
import {
  matchLifiApproval,
  matchLifiQuote,
  matchLifiSwapPrep,
} from "./families/lifi";
import { matchJupiterSwapPrep } from "./families/jupiter";
import { matchSvmContext, matchSvmTokenHoldings } from "./families/svm";
import { matchSvmPendingApproval, matchSvmSimulation } from "./families/svm-tx";
import { matchEvmCall } from "./families/evm-call";
import { matchTaskDelegation } from "./families/task";
import { presentOperation } from "./present";
import type {
  InterpretedToolStep,
  ToolConfidence,
  ToolContext,
  ToolMatcher,
} from "./types";

const matchers: ToolMatcher[] = [
  matchTaskDelegation,
  matchWebSearch,
  matchSkillActivation,
  matchSvmContext,
  matchSvmTokenHoldings,
  matchChainContext,
  matchNativeBalance,
  matchTokenLookup,
  matchJupiterSwapPrep,
  matchLifiSwapPrep,
  matchLifiQuote,
  matchLifiApproval,
  matchSvmSimulation,
  matchSvmPendingApproval,
  matchStagedTx,
  matchEvmSimulation,
  matchEvmPendingApproval,
  matchEvmCall,
  matchError,
];

const fallbackOperation = (ctx: ToolContext) => {
  const args = asRecord(ctx.parsedArgs);
  const symbol = asString(args?.symbol);
  const facts = uniqueFacts(
    [
      topicTokenFact(ctx.rawLabel),
      chainFact(args?.chain_id, args?.chain_name, "args"),
      symbol ? tokenFact(symbol, "args") : null,
    ].filter((fact): fact is NonNullable<typeof fact> => fact != null),
  );

  const confidence: ToolConfidence = facts.length > 0 ? "medium" : "fallback";

  return {
    id: "fallback",
    facts,
    confidence,
    rawLabel: ctx.rawLabel,
  };
};

export const interpretToolContext = (ctx: ToolContext): InterpretedToolStep => {
  const operation =
    matchers.reduce<ReturnType<ToolMatcher>>(
      (matched, matcher) => matched ?? matcher(ctx),
      null,
    ) ?? fallbackOperation(ctx);

  return presentOperation(operation);
};
