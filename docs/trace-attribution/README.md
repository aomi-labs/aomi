# Agent and skill attribution

Agent-owned skill activations display their structured `publisher/agent/skill` identifier as
`Agent / Skill`, with a graphical slash and agent artwork when the publisher identity
is known. Names and routing IDs remain separate. Main and delegated traces and
the activity sidebar share the attribution context and badge component.
On tool rows, network and transaction or quote facts appear first; ownership
badges follow them and never consume the data-chip limit.
The core `evm_get_token_balance` result shows its network, verified token identity,
holder, and exact reported balance. Unknown token contracts show a shortened
address without an inferred symbol or unit.
The merged `common_erc20` skill also uses `evm_get_token_holdings`; its row shows
network, returned versus matching holdings, holder, and a warning or incomplete
state when reported. Token metadata from the indexer stays in the raw details.
These are core EVM tools, so listing them in a skill does not imply skill ownership.
Both families' holdings rows end with the priced holdings' USD total. Every
Solana tool row mirrors its EVM pair: `svm_get_token_holdings` shows the USD
total then each amount, `svm_stage_ix` its action (the instruction's kind),
`svm_simulate` its legs, summed compute units and verdict, and a one-transaction
`svm_commit_txs` the landed signature, as `evm_commit_txs` shows the hash. The
`spl_token` skill reads `SPL Token` with the coin mark, like `common_erc20`.

Tool ownership is metadata-driven for every agent:

- An agent badge requires exact membership in its descriptor's
  `metadata.tool_names` array.
- A skill badge requires exact membership in the skill catalog's
  `injected_tools` array.
- Multiple declared owners are ambiguous and are not resolved by guessing.
- A tool-name prefix, protocol-specific result shape, current agent selection or
  previously activated skill is not proof of ownership.

The `publisher/agent/skill` namespace is used to display a skill activation that the backend
explicitly reported. It is never matched against a tool name to infer ownership.
Artwork comes from the existing agent/skill icon registry; unknown/community or
ambiguous publishers retain a generic icon. No agent-specific attribution branches
or per-agent tool lists are maintained in the frontend.

Agent cards come from explicit key resolution and use a canonical
`publisher/name` identity. Missing or ambiguous declarations stay untagged.
