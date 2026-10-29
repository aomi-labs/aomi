---
"@aomi-labs/client": minor
---

Solana builds commit like EVM ones. `build.commit()` answers a Commit for a Solana build, and `pipeline.svm.commit()` returns Commit Service `commits` with their `thread_id` (Commit Service sizes the compute budget, resends until the blockhash expires and reports the confirmed wallet changes) instead of wallet requests to sign and send yourself. `pipeline.svm.commits(result)` follows them. The `execute_svm` wallet capability is gone: no Solana Action reaches a wallet any more.
