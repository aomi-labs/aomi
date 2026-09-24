import type { ToolMatcher } from "../../types";
import { matchErc20Balance, matchNativeBalance } from "./account";
import { matchEvmCall } from "./call";
import { matchChainContext } from "./context";
import { matchTokenLookup } from "./contract";
import {
  matchEvmPendingApproval,
  matchEvmSimulation,
  matchStagedTx,
} from "./transactions";

const matchers: Record<string, ToolMatcher[]> = {
  evm_stage_tx: [matchStagedTx],
  "evm stage": [matchStagedTx],
  simulate_batch: [matchEvmSimulation],
  evm_commit_txs: [matchEvmPendingApproval],
  get_time_and_onchain_context: [matchChainContext, matchEvmCall],
  get_account_info: [matchNativeBalance],
  get_erc20_balance: [matchErc20Balance],
  get_contract: [matchTokenLookup],
  encode_and_call: [matchEvmCall],
  sim_call: [matchEvmCall],
};

export const evmMatchersFor = (name: string): ToolMatcher[] | undefined =>
  Object.hasOwn(matchers, name) ? matchers[name] : undefined;
