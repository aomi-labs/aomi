---
"@aomi-labs/client": minor
"@aomi-labs/widget": patch
"@aomi-labs/cli": patch
---

The SDK owns the policy deploy flow, so every surface runs the same one. `aomi.account.policy.enforce(agentWalletId, entry, signer, options)` prepares the step, checks the action (its network, a MetaMask target, no value attached, sent from the owner), has the wallet act and confirms, retrying while the chain settles. It answers `{ policies, settled, transaction? }`: `transaction` is the Solana signature or EVM hash the wallet returned, and `settled` is false, not an error, when the backend's node still does not show a sent transaction after the retries. `AomiPolicySigner.sendEvmTransaction` may answer the hash. A surface passes an `AomiPolicySigner`: sign EIP-712 data, send an EVM transaction, send a Solana transaction. `signableTypedData`, `policyFromDraft`, `upsertPolicy`, `toBaseUnits`, `enforcementKey` and `sendsRevocation` are exported; the widget calls them and keeps only what it shows. In the widget, a step that asks nothing of a wallet needs none connected once the policy's owner is known.

Breaking: `aomi.account.rules` is `aomi.account.policy`, with no alias. The types follow: `AomiRule*`/`AomiRules*` are `AomiPolicy*` (`AomiRuleChange` is `AomiPolicyChange`, `AomiWalletRules` is `AomiWalletPolicies`, `AccountRulesTransport` is `AccountPolicyTransport`), `RULES_ERROR_CODES` is `POLICY_ERROR_CODES`, `hasRules` is `hasPolicies` and `ruleKey` is `policyKey`. Wire field names, error code strings and the REST paths still say `rules`.
