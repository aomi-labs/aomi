/** The declared tool name, without an app or namespace prefix. */
export const toolIdentity = (label: string): string =>
  (
    label
      .toLowerCase()
      .split(/::|[.:/]/)
      .at(-1) ?? ""
  ).trim();

/** Full declared name for matching registered tools, including any namespace. */
export const declaredToolIdentity = (label: string): string =>
  label.toLowerCase().trim();

/** Titles for Aomi-owned tools. Keep these stable before and after a result. */
const coreTitles: Record<string, string> = {
  evm_stage_tx: "Stage transaction",
  "evm stage": "Stage transaction", // Older traces used this display label.
  svm_stage_ix: "Stage transaction",
  svm_stage_tx: "Stage transaction",
  simulate_batch: "Simulate transaction",
  svm_simulate_ix: "Simulate transaction",
  svm_simulate_tx: "Simulate transaction",
  evm_commit_txs: "Commit transactions",
  svm_commit_txs: "Commit transactions",
  evm_commit_message: "Sign message",
  svm_sign_data: "Sign message",
  brave_search: "Search web",
  search_docs: "Search docs",
  activate_skills: "Activate skill",
  get_contract: "Get contract details",
  svm_get_program: "Get program details",
  encode_and_call: "Call contract",
  sim_call: "Call contract",
  sim_open: "Open simulation",
  sim_apply: "Apply simulation",
  sim_snapshot: "Save simulation snapshot",
  sim_revert: "Revert simulation",
  sim_close: "Close simulation",
  get_erc20_balance: "Get balance",
  get_erc20_holdings: "Get token holdings",
  get_account_info: "Get account details",
  svm_get_account_info: "Get account details",
  svm_get_context: "Check network",
  get_time_and_onchain_context: "Check network",
  svm_get_token_holdings: "Get token holdings",
  sync_chain: "Sync network",
};

export const coreToolTitle = (label: string): string | undefined => {
  const name = declaredToolIdentity(label);
  return Object.hasOwn(coreTitles, name) ? coreTitles[name] : undefined;
};
