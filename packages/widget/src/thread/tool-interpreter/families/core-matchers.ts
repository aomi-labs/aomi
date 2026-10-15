import { type ToolMatcher } from "@/thread/tool-interpreter/types";
import {
  matchErc20Balance,
  matchErc20Holdings,
  matchNativeBalance,
} from "@/thread/tool-interpreter/families/evm/account";
import { matchEvmCall } from "@/thread/tool-interpreter/families/evm/call";
import {
  matchChainContext,
  matchSyncChain,
} from "@/thread/tool-interpreter/families/evm/context";
import { matchTokenLookup } from "@/thread/tool-interpreter/families/evm/contract";
import {
  matchEvmPendingApproval,
  matchEvmSimulation,
  matchStagedTx,
} from "@/thread/tool-interpreter/families/evm/transactions";
import {
  matchGetTransaction,
  matchListTransactions,
} from "@/thread/tool-interpreter/families/general/activity";
import { matchSkillActivation } from "@/thread/tool-interpreter/families/general/skills";
import { matchSleep } from "@/thread/tool-interpreter/families/general/sleep";
import {
  matchWebFetch,
  matchWebSearch,
} from "@/thread/tool-interpreter/families/general/search";
import { matchTaskDelegation } from "@/thread/tool-interpreter/families/general/task";
import {
  matchSvmContext,
  matchSvmTokenHoldings,
} from "@/thread/tool-interpreter/families/svm/context";
import {
  matchSvmPendingApproval,
  matchSvmSimulation,
  matchSvmStage,
} from "@/thread/tool-interpreter/families/svm/transactions";

const evmMatchers: Record<string, ToolMatcher[]> = {
  evm_stage_tx: [matchStagedTx],
  "evm stage": [matchStagedTx],
  simulate_batch: [matchEvmSimulation],
  evm_commit_txs: [matchEvmPendingApproval],
  get_time_and_onchain_context: [matchChainContext, matchEvmCall],
  sync_chain: [matchSyncChain],
  get_account_info: [matchNativeBalance],
  get_erc20_balance: [matchErc20Balance],
  get_erc20_holdings: [matchErc20Holdings],
  get_contract: [matchTokenLookup],
  encode_and_call: [matchEvmCall],
  sim_call: [matchEvmCall],
};

const generalMatchers: Record<string, ToolMatcher> = {
  task: matchTaskDelegation,
  web_search: matchWebSearch,
  brave_search: matchWebSearch,
  web_fetch: matchWebFetch,
  search_docs: matchWebSearch,
  activate_skills: matchSkillActivation,
  sleep: matchSleep,
  list_transactions: matchListTransactions,
  get_transaction: matchGetTransaction,
};

const svmMatchers: Record<string, ToolMatcher> = {
  svm_stage_ix: matchSvmStage,
  svm_stage_tx: matchSvmStage,
  svm_simulate_ix: matchSvmSimulation,
  svm_simulate_tx: matchSvmSimulation,
  svm_commit_txs: matchSvmPendingApproval,
  svm_get_context: matchSvmContext,
  svm_get_token_holdings: matchSvmTokenHoldings,
};

export function coreMatchersFor(name: string): ToolMatcher[] | undefined {
  if (Object.hasOwn(generalMatchers, name)) return [generalMatchers[name]];
  if (Object.hasOwn(evmMatchers, name)) return evmMatchers[name];
  if (Object.hasOwn(svmMatchers, name)) return [svmMatchers[name]];
  return undefined;
}
