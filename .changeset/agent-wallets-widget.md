---
"@aomi-labs/widget": minor
---

Agent wallets in the wallet menu and Settings: create (portal only), rename, pause, archive, deposit (QR) and withdraw, with Pause all; Settings › Connections sets which wallets each connection may use, Ask or Instant. Consent pre-fills a client's current access and writes nothing when it is unchanged. Each connection has "Can approve trades" (`CanApproveTrades`, also on the consent sheet and the terminal sign-in page) for approving its own Ask trades. Approve in the sidebar and on the sign page (`CommitSignPanel`), which, like withdraw, follows the whole batch. `TelegramLinkPanel` links a Telegram account. Thread rows mark chats started elsewhere (scheduled, MCP/API, CLI/SDK, Telegram, inside an app). Removed: provider-delegated and client-side automatic signing (`usePrivyDelegation`, `PrivyDelegationProvider`).
