---
"@aomi-labs/client": minor
"@aomi-labs/widget": minor
"@aomi-labs/cli": patch
---

Agent wallet rules become Policies on screen, with a total and an active period. The wire names stay `rules`.

The client exports 11 policy type aliases, including `AomiPolicy`, `AomiPolicySet`, and `AomiWalletPolicies`. Existing rule type names remain available.

Client: an `AomiRule` amount is a total that never resets, and a rule gains `active_from` (set by the server) and `active_until` (unix seconds, left out for always on; a write sends it). An ended rule stays in the list. `RULES_ERROR_CODES.periodInvalid` (`rules_period_invalid`) is the refusal for an end that is not in the future. Breaking: `AomiWalletRules.usage`, `AomiWalletRules.window_ends_at` and the type `AomiRuleUsage` are removed; nothing counts spend any more.

Client, per-rule on-chain enforcement (the backend deploys one on-chain role or grant per rule, not one per wallet and network). Breaking: `AomiWalletRules.enforcement` has one `AomiRulesEnforcement` entry per rule and provider. An entry is now `{ rule, provider, name, network, state, ready, left, expires_at, account, deployment_tx, note, signer }`: `rule` is the rule's key, `left` is what the chain will still let through (a decimal string in the rule's own base units, or null), `expires_at` is the chain's end for the rule in unix seconds (an estimate), `account` is the address that holds the funds, `deployment_tx` is what the owner's wallet returned (null for a signed grant). `rules`, `holds` and the per-asset `left` map are removed. `AomiRulesEnforceRequest` now needs `rule`, the entry's rule key, so `prepareEnforcement` and `confirmEnforcement` act on one rule. `AomiRulesAction` is a union: besides `transaction` there is `typed_data` (`network`, `typed_data: AomiRulesTypedData`), EIP-712 data the owner's EVM wallet signs and sends nothing; numbers above 2^53 in its `message` are decimal strings, so convert the fields its types declare as integers before signing. `confirmEnforcement` takes `AomiRulesConfirmRequest`, the same body plus an optional `signature` (0x hex), which a `typed_data` action needs and a `transaction` action does not. The client refuses an action kind it does not know; a caller must also refuse an action whose `network` is not the entry's. New `RULES_ERROR_CODES`: `notEnforceable`, `ruleNotFound`, `bindingNotFound`, `providerNotFound`, `deploymentTooLarge`, `stepSignatureRequired`, `stepSignatureInvalid`, `stepSignatureUnexpected`. Needs a backend with per-rule enforcement; an older one answers entries this client refuses to parse.

Widget: Settings gains a Policies tab (`policies`, after Connections) that lists every agent wallet's policies: the two switches, the picker (`token / amount / chain / to`, several chains at once, an optional active period), each policy's own on-chain enforcement (the provider, its state, what the chain still lets through, "Sign to deploy" and a link to the deployment or the owner's account), signing a Swig transaction or an EVM typed-data grant with the owner's wallet (it refuses a step for another network than the policy's), waiting policy changes at the top, and the policy change authority. The agent wallet's Manage sheet shows a count of connections and policies with links to those tabs in place of the Rules section. A rule change reads "Policy change" there and on `/rules/<change id>`.

CLI: `aomi rules` no longer prints a `used` line.

Client and widget, the picker's hint: `AomiWalletRules.providers` (type `AomiRulesProvider`, `{ provider, name, network, holds, note }`) lists each on-chain provider and network the backend has switched on that could hold the wallet's rules, with or without a rule on it; `holds` is `total_and_period` or `total_period_and_destination`. A backend that does not send it reads as an empty list. The Policies picker names the provider for each chosen chain from it ("None" only where no provider covers the network) and says when a provider leaves the destination to Aomi.

The owner signs a MetaMask grant revocation and sends it as a zero-value transaction to the delegation manager from their connected wallet. The widget confirms against the chain's disabled flag.

The Policies card shows balances for each MetaMask vault and chain. Withdraw signs a single-use delegation valid for ten minutes and redeems it from the owner's wallet.
