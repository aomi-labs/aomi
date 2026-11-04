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
  evm_simulate: "Simulate transaction",
  svm_simulate: "Simulate transaction",
  evm_discard_tx: "Discard transactions",
  svm_discard_tx: "Discard transactions",
  evm_commit_txs: "Commit transactions",
  svm_commit_txs: "Commit transactions",
  evm_commit_message: "Sign message",
  svm_commit_message: "Sign message",
  web_search: "Search web",
  brave_search: "Search web", // Persisted threads before the web_search rename.
  web_fetch: "Read page",
  search_docs: "Search docs",
  activate_skills: "Activate skill",
  sleep: "Sleep",
  evm_get_contract: "Get contract details",
  svm_get_program: "Get program details",
  svm_derive_address: "Derive address",
  evm_call: "Call contract",
  evm_sim_call: "Call contract",
  evm_sim_open: "Open simulation",
  evm_sim_apply: "Apply simulation",
  evm_sim_snapshot: "Save simulation snapshot",
  evm_sim_revert: "Revert simulation",
  evm_sim_close: "Close simulation",
  evm_get_token_balance: "Get balance",
  evm_get_token_holdings: "Get holdings",
  evm_get_account_info: "Get account details",
  svm_get_account_info: "Get account details",
  svm_get_context: "Check network",
  evm_get_context: "Check network",
  svm_get_token_holdings: "Get holdings",
  list_transactions: "List transactions",
  get_transaction: "Get transaction",
  evm_sync_chain: "Sync network",
  read_tool_output: "Read saved tool output",
};

export const coreToolTitle = (label: string): string | undefined => {
  const name = declaredToolIdentity(label);
  return Object.hasOwn(coreTitles, name) ? coreTitles[name] : undefined;
};
