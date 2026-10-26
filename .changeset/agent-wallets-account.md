---
"@aomi-labs/account": minor
---

Agent wallets: agent keys map to `kind: "agent"` and can't be removed or count as login factors; deactivating an account pauses all its agent wallets. Connections list each connection's lane on its agent wallets (`portal`, `here`, `instant`; a wallet left out has the client's default) and `askOnly`, and name the bot that linked Telegram; deactivating puts every lane back on `portal`. An account merge waits while the other account has a trade in flight or a Telegram link is running. `custody:delegate` is no longer granted, and the Telegram Mini App sign-in helpers are removed. The shared policy (`@aomi-labs/account/policy`) adds the `/v1` resource (one CLI and SDK sign-in accepted on the three REST APIs) and app-locked MCP resources (`/v1/apps/<app>/mcp`, with `resourcePolicy`, `appMcpName`, `appMcpResource` and `acceptsApiToken`), and drops the `custody` and `managed_signing` capabilities.
