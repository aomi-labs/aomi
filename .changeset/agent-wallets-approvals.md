---
"@aomi-labs/client": patch
"@aomi-labs/react": patch
"@aomi-labs/widget": patch
"@aomi-labs/cli": patch
"@aomi-labs/account": patch
---

Approvals everywhere (agent wallets, step 4). An agent-wallet commit from a client that is not on Instant waits as `awaiting_approval`; nothing is signed until a portal or CLI login approves it.

Client: `CommitHandle.approve()` and `CommitController.approve(id, review?)` (thread-less `/v1/commits/:ref/approve`, one call per batch), `CommitView.state` `awaiting_approval` and `CommitView.approval`, `CommitRefView.can_approve`, `CommitApprovalForbiddenError` / `CommitExpiredError` / `CommitNotAwaitingApprovalError`, lifecycle phases `awaiting_approval` and `signing`, `aomi.wallets.rule()` / `setRule()` and `client.account.connections`.

React: `ThreadMetadata.awaitingApproval`.

Widget: Approve / "Approve on Aomi ↗" in the sidebar and on the sign page, Retry after expiry, the amber dot for waiting approvals, and a compact Safety page: per-agent-wallet Pause and Instant per client, Locked wallets with Unlock, Connected apps with Disconnect.

CLI: `aomi tx approve <ref>`, `aomi wallets [use <id>]`, and the approval hint in `aomi chat`.

Account: `custody:delegate` is no longer granted; connected OAuth clients and Telegram bots are listed and disconnected from the Better Auth tables.
