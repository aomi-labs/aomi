import { type ToolMatcher } from "../types";
import {
  matchErc20Balance,
  matchErc20Holdings,
  matchNativeBalance,
} from "./evm/account";
import { matchEvmCall } from "./evm/call";
import { matchChainContext, matchSyncChain } from "./evm/context";
import { matchTokenLookup } from "./evm/contract";
import {
  matchEvmPendingApproval,
  matchEvmSimulation,
  matchStagedTx,
} from "./evm/transactions";
import { matchGetTransaction, matchListTransactions } from "./general/activity";
import { matchDiscardTx } from "./general/discard-tx";
import { matchSignMessage } from "./general/sign-message";
import { matchSkillActivation } from "./general/skills";
import { matchSleep } from "./general/sleep";
import { matchWebFetch, matchWebSearch } from "./general/search";
import { matchTaskDelegation } from "./general/task";
import {
  matchSvmAccountInfo,
  matchSvmContext,
  matchSvmDeriveAddress,
  matchSvmProgram,
  matchSvmTokenHoldings,
} from "./svm/context";
import {
  matchSvmPendingApproval,
  matchSvmSimulation,
  matchSvmStage,
} from "./svm/transactions";

const evmMatchers: Record<string, ToolMatcher[]> = {
  evm_stage_tx: [matchStagedTx],
  evm_discard_tx: [matchDiscardTx],
  "evm stage": [matchStagedTx],
  evm_simulate: [matchEvmSimulation],
  evm_commit_txs: [matchEvmPendingApproval],
  evm_commit_message: [matchSignMessage],
  evm_get_context: [matchChainContext, matchEvmCall],
  evm_sync_chain: [matchSyncChain],
  evm_get_account_info: [matchNativeBalance],
  evm_get_token_balance: [matchErc20Balance],
  evm_get_token_holdings: [matchErc20Holdings],
  evm_get_contract: [matchTokenLookup],
  evm_call: [matchEvmCall],
  evm_sim_call: [matchEvmCall],
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
  svm_discard_tx: matchDiscardTx,
  svm_simulate: matchSvmSimulation,
  svm_commit_txs: matchSvmPendingApproval,
  svm_commit_message: matchSignMessage,
  svm_get_context: matchSvmContext,
  svm_get_token_holdings: matchSvmTokenHoldings,
  svm_get_program: matchSvmProgram,
  svm_get_account_info: matchSvmAccountInfo,
  svm_derive_address: matchSvmDeriveAddress,
};

export function coreMatchersFor(name: string): ToolMatcher[] | undefined {
  if (Object.hasOwn(generalMatchers, name)) return [generalMatchers[name]];
  if (Object.hasOwn(evmMatchers, name)) return evmMatchers[name];
  if (Object.hasOwn(svmMatchers, name)) return [svmMatchers[name]];
  return undefined;
}
