---
"@aomi-labs/account": minor
---

Agent wallets: agent keys map to `kind: "agent"` and can't be removed or count as login factors; deactivating an account pauses all its agent wallets. Connections list each connection's agent wallet access, `askOnly` and `approves` (NULL is the default: Telegram yes, others no; the portal always), and name the bot that linked Telegram. An account merge waits while the other account has a trade in flight or a Telegram link is running. `custody:delegate` is no longer granted, and the Telegram Mini App sign-in helpers are removed.
