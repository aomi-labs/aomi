---
"@aomi-labs/client": minor
"@aomi-labs/widget": minor
"@aomi-labs/cli": patch
---

Agent wallet rules have one shape: a mode and a list of rules, each a token, an amount a day and where it may go.

- `AomiRuleSet` is now `{ mode, rules, linked_only }`. `mode` is `whitelist` (only what is listed may be spent) or `blacklist` (everything, except what is listed). A rule's `to` is one app, any app, or one address for a send. An amount of `"0"` blocks. `apps`, `limits`, `not_after` and `owner_only` are gone, with `AomiRuleLimit`.
- `AomiWalletRules.enforced_by` names who enforces each rule, by rule id. `AomiRulesEnforcement.covers` is replaced by `rules`, the ids it stands behind, and `holds`, the daily total it holds per asset. `AomiRulesCovers` is gone.
- `ruleKey(rule)` gives the id the server counts a rule's spend under.
- Wallet › Manage › Rules is rebuilt on it: a switch for sends to linked wallets, a whitelist or blacklist toggle, one `token / amount / chain / to` field for a new rule, who enforces each rule on the rule itself, and "Rule change authority" with self-approval or a selected wallet. Templates, the app list and the end date are removed.
- `aomi rules` prints each rule's use with its destination.

Needs a backend with the same rule shape; an older one answers rules this client refuses to parse.
