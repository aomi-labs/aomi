import { coreToolTitle, toolIdentity } from "./identity";
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
import { isSupportedProtocolTool, matchProtocol } from "./families/protocol";
import { matchJupiterSwapPrep } from "./families/jupiter";
import { matchSvmContext, matchSvmTokenHoldings } from "./families/svm";
import {
  matchSvmPendingApproval,
  matchSvmSimulation,
  matchSvmStage,
} from "./families/svm-tx";
import { matchEvmCall } from "./families/evm-call";
import { matchTaskDelegation } from "./families/task";
import { presentOperation } from "./present";
import type {
  InterpretedToolStep,
  ToolConfidence,
  ToolContext,
  ToolMatcher,
} from "./types";

/** Identity selects an adapter; payload shape only determines facts inside it. */
const matchersFor = (name: string): ToolMatcher[] => {
  if (isSupportedProtocolTool(name)) return [matchProtocol, matchError];
  switch (name) {
    case "task":
      return [matchTaskDelegation, matchError];
    case "svm_stage_ix":
    case "svm_stage_tx":
      return [matchSvmStage, matchError];
    case "svm_simulate_ix":
    case "svm_simulate_tx":
      return [matchSvmSimulation, matchError];
    case "svm_commit_txs":
      return [matchSvmPendingApproval, matchError];
    case "evm_stage_tx":
    case "evm stage":
      return [matchStagedTx, matchError];
    case "simulate_batch":
      return [matchEvmSimulation, matchError];
    case "evm_commit_txs":
      return [matchEvmPendingApproval, matchError];
    case "brave_search":
    case "search_docs":
      return [matchWebSearch, matchError];
    case "activate_skills":
      return [matchSkillActivation, matchError];
    case "svm_get_context":
      return [matchSvmContext, matchError];
    case "svm_get_token_holdings":
      return [matchSvmTokenHoldings, matchError];
    case "get_time_and_onchain_context":
      return [matchChainContext, matchEvmCall, matchError];
    case "get_account_info":
      return [matchNativeBalance, matchError];
    case "get_contract":
      return [matchTokenLookup, matchError];
    case "encode_and_call":
    case "sim_call":
      return [matchEvmCall, matchError];
    case "jupiter_prepare_swap":
      return [matchJupiterSwapPrep, matchError];
    case "lifi_prepare_swap_tx":
    case "lifi_prepare_swap_batch":
      return [matchLifiSwapPrep, matchError];
    case "lifi_get_quote":
      return [matchLifiQuote, matchError];
    case "lifi_prepare_approval_tx":
      return [matchLifiApproval, matchError];
    default:
      return [matchError];
  }
};

const fallbackOperation = (ctx: ToolContext) => {
  const name = toolIdentity(ctx.rawLabel);
  const coreIds: Record<string, string> = {
    brave_search: "web.search",
    activate_skills: "skill.activate",
    get_contract: "evm.contract.lookup.found",
    encode_and_call: "evm.call.generic",
    sim_call: "evm.call.generic",
  };
  const coreId = Object.hasOwn(coreIds, name) ? coreIds[name] : undefined;
  const confidence: ToolConfidence = coreId ? "high" : "fallback";

  return {
    id: coreId ?? "fallback",
    facts: [],
    confidence,
    rawLabel: ctx.rawLabel,
    title: coreToolTitle(ctx.rawLabel),
  };
};

export const interpretToolContext = (ctx: ToolContext): InterpretedToolStep => {
  const name = toolIdentity(ctx.rawLabel);
  const operation =
    matchersFor(name).reduce<ReturnType<ToolMatcher>>(
      (matched, matcher) => matched ?? matcher(ctx),
      null,
    ) ?? fallbackOperation(ctx);

  const coreTitle = coreToolTitle(ctx.rawLabel);
  const keepsSemanticTitle = operation.id.startsWith("evm.call.erc20.");
  return presentOperation({
    ...operation,
    title: keepsSemanticTitle
      ? operation.title
      : (coreTitle ?? operation.title),
  });
};
