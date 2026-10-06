import type { ToolMatcher } from "../../types";
import { matchSvmContext, matchSvmTokenHoldings } from "./context";
import {
  matchSvmPendingApproval,
  matchSvmSimulation,
  matchSvmStage,
} from "./transactions";

const matchers: Record<string, ToolMatcher> = {
  svm_stage_ix: matchSvmStage,
  svm_stage_tx: matchSvmStage,
  svm_simulate_ix: matchSvmSimulation,
  svm_simulate_tx: matchSvmSimulation,
  svm_commit_txs: matchSvmPendingApproval,
  svm_get_context: matchSvmContext,
  svm_get_token_holdings: matchSvmTokenHoldings,
};

export const svmMatcherFor = (name: string): ToolMatcher | undefined =>
  Object.hasOwn(matchers, name) ? matchers[name] : undefined;
