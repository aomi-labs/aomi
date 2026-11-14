---
"@aomi-labs/client": minor
"@aomi-labs/widget": minor
"@aomi-labs/cli": minor
"@aomi-labs/account": minor
---

Agent wallet rules. `aomi.account.rules` reads a wallet's rules (allowed apps, a daily limit per asset, an end date, sends only to your wallets), changes them, lists the catalog they pick from, and reads, approves or declines a rule change. A change that only takes power away applies at once; one that gives power or changes the admin waits for the wallet's admin. In the widget, Wallet › Manage gains a Rules section with the waiting change, inline controls and the admin picker, and a lane made Instant on a wallet whose admin is a wallet files a rule change to sign. The Portal serves `/rules/<change id>`. The CLI adds `aomi rules`, `aomi rules approve <change-id>` and `aomi rules decline <change-id>`. A commit a rule refuses (`commit_rule_*`) shows the rule's message and no Approve. In the account policy, rule changes need the new `OWNER_SESSION` requirement (the portal session or a CLI session), and a portal approval without a wallet signature needs a sign-in from the last 10 minutes (403 `login_stale`).

The Rules section offers three templates. Where an on-chain provider can hold a wallet's rules, the rules response lists it in `enforcement` (name, state, the rules it covers, what the chain has left, who signs), and the section shows it the same way for every provider: the header names who enforces, each rule says who checks it, and one row turns it on, updates it or turns it off. `aomi.account.rules.prepareEnforcement` and `confirmEnforcement` run the owner's wallet ceremony; the backend derives the policy from the rules, so a client never builds one or names a provider. The separate Limits step, its form and the widget's Swig-specific policy helpers are removed.

A session sent as a bearer is now held to the same recent sign-in as the cookie on rule-change approval (it is the same token), where it used to be exempt.

Breaking: `aomi.account.policies` (`AccountPoliciesTransport`) and the types `AomiOnchainPolicyProviderCtx`, `AomiBindOnchainPolicy` and `AomiPreparedOnchainPolicy` are removed, with the `/v1/account/policies/*` routes at the edge. They were the Swig-only way to put limits on chain; `aomi.account.rules` does that for every provider. `AomiRulesCovers` names what a provider holds.
