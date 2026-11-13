---
"@aomi-labs/client": minor
"@aomi-labs/widget": minor
"@aomi-labs/cli": minor
"@aomi-labs/account": minor
---

Agent wallet rules. `aomi.account.rules` reads a wallet's rules (allowed apps, a daily limit per asset, an end date, sends only to your wallets), changes them, lists the catalog they pick from, and reads, approves or declines a rule change. A change that only takes power away applies at once; one that gives power or changes the admin waits for the wallet's admin. In the widget, Wallet › Manage gains a Rules section with the waiting change, inline controls and the admin picker, and a lane made Instant on a wallet whose admin is a wallet files a rule change to sign. The Portal serves `/rules/<change id>`. The CLI adds `aomi rules`, `aomi rules approve <change-id>` and `aomi rules decline <change-id>`. A commit a rule refuses (`commit_rule_*`) shows the rule's message and no Approve. In the account policy, rule changes need the new `OWNER_SESSION` requirement (the portal session or a CLI session), and a portal approval without a wallet signature needs a sign-in from the last 10 minutes (403 `login_stale`).

The Rules section offers three templates, and where Swig is on it shows the same rules on chain: the policy comes from the wallet's rules (`from_rules` on the Swig context), and the owner's Solana wallet signs it. The separate Limits step and its form are removed; `useWalletLimits` moves to `account/rules/onchain-rules`.
