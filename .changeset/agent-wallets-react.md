---
"@aomi-labs/react": minor
---

Agent wallets: `AomiRuntimeApi` exposes `activeWallet` and `setThreadWallet(id)`, the user state carries `wallet_pick`, `wallet_presence` and `active_wallet`, and `createThread({ draft })` prefills the composer. `ThreadMetadata` carries `origin`, `originApp` and `awaitingApproval`; chats started in Telegram are listed like any other. Display resources `account-wallets`, `wallet-balance` and `connections`.
