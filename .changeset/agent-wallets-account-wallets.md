---
"@aomi-labs/client": minor
"@aomi-labs/react": minor
"@aomi-labs/widget": minor
"@aomi-labs/account": minor
---

Agent wallets: one per account, in the wallet list, with deposit and balance.

Client: `client.account.wallets` (`AccountWalletsTransport`) lists every wallet the account owns (`listWallets()`, agent wallets first), creates the default agent wallets (`createAgentWallets(families?)`), reads a wallet's per-chain balance (`walletBalance(id)`) and switches a thread's active wallet (`setThreadWallet(threadId, id)`). Failures are `AomiWalletError` with the server's code (`WALLET_ERROR_CODES`). Wallet ids are `w_<id>` (`walletRef`, `parseWalletRef`). The SDK adds `aomi.wallets.list()` and `aomi.wallets.balance(id)`; OAuth clients need `agent:read`. `UserState` gains `wallet_pick`, `wallet_presence` and `active_wallet`, and `SessionSnapshot.activeWallet` / `Session.setActiveWallet()` carry the thread's active wallet. These wire types are hand-written in `account/wallets.ts` until the agent API is regenerated. `AccountGraphWallet.kind` may be `"agent"`.

React: `AomiRuntimeApi` exposes `activeWallet` and `setThreadWallet(id)`, and `createThread({ draft })` prefills the new chat's composer. Display resources `account-wallets` and `wallet-balance`. A disconnect keeps the device's `wallet_pick` and `wallet_presence`.

Widget: Settings › Account shows an Agent wallet group (balance, chains, Deposit, Active, Use this wallet, Withdraw to…, Rename, View on explorer, and Create agent wallet when there is none). Deposit opens a lazily loaded sheet with an EIP-681 / `solana:` QR code (`uqr`), the full address and a per-chain gas note, polling the balance while open. An agent wallet is a normal pick in the signs-with strip, with no connector or popup; it never becomes the default or a stand-in, and while it is picked the browser offers no local signing for its family (`WalletSource` `"agent"`). The wallet kit sends `wallet_pick` and `wallet_presence` with the user state. The composer shows "This chat uses <wallet> · Switch" when a chat's wallet is not this device's pick. The Para "Create agent wallet" offer in Safety is gone.

Account: wallets backed by an active agent wallet row map to `kind: "agent"`; `DELETE /v1/account/wallets/:id` refuses them with 409 `agent_wallet_not_removable`, account deletion keeps them, and provider-managed keys no longer count as login factors. Wallet PATCH/DELETE accept `w_<id>`, and a name over 40 characters is 400 `label_too_long`.
