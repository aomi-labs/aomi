---
"@aomi-labs/client": minor
---

Agent wallets and approvals.

- `client.account.wallets`: `listWallets()` (every wallet the account owns; an agent key carries `agent_wallet_id` and `maker_app`, a browser one `browser_app`), `walletBalance(id)`, `agentWallets()` (`{pause_all, wallets}`), `createAgentWallet`, `updateAgentWallet` (rename, pause, archive), `agentWalletBalances`, `withdrawAgentWallet`, `pauseAll(paused)` (`PUT /v1/account/pause-all`) and `setThreadWallet(threadId, id)`. Failures are `AomiWalletError`; wallet ids are `w_<id>` (`walletRef`, `parseWalletRef`).
- `client.account.connections`: list, label, `setConnectionWallets(key, {wallets, application?, new_app_wallet?, ask_only?})` and disconnect. `ask_only` marks a connection that never signs Instant.
- `client.account.telegramLink`: preview, confirm and cancel a `/link` code (`TelegramLinkError`).
- `aomi.commits.get(ref)` opens a commit without a thread (`CommitHandle`: `view`, `review`, `refresh()`, `sign()`, `approve()`, `reject()`). It loads every member of the commit's batch; `batch` lists them and `settled` says when the whole operation is over. Writes name the reviewed version and digest (`CommitStaleError`); `CommitNotFoundError`, `CommitApprovalForbiddenError`, `CommitExpiredError`, `CommitNotAwaitingApprovalError`.
- `CommitView` gains the `awaiting_approval` state and `approval`; `CommitRefView` gains `can_approve` and `sign_url`.
- Removed: client-side automatic signing (`beginPrivyDelegation`, `client_auto`).
