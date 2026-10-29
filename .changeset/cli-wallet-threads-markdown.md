---
"@aomi-labs/client": minor
"@aomi-labs/cli": patch
---

`thread.history()` returns what was said in a thread and its active wallet; `aomi.account.wallets.use(id, { thread })` switches a thread's wallet. The CLI chat screen renders replies as markdown, shows a thread's history when it continues one, adds `/threads` to continue another and `/wallet` to pick the thread's wallet (each described by how it signs), and shows that wallet in the status bar. `aomi wallets` gains a SIGNS column and `aomi threads show` prints a thread.
