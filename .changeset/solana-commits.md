---
"@aomi-labs/client": minor
---

Solana builds commit like EVM ones. `build.commit()` answers a Commit for a Solana build, and `pipeline.svm.commit()` returns Commit Service `commits` with their `thread_id` (Commit Service sizes the compute budget, resends until the blockhash expires and reports the confirmed wallet changes) instead of wallet requests to sign and send yourself. `pipeline.svm.commits(result)` follows them. The `execute_svm` wallet capability is gone: no Solana Action reaches a wallet any more.

Commit results are one union tagged by `family` (`"evm"` or `"svm"`), and a Solana commit continues under `/v1/pipeline/svm/commits/:id` (the `/evm/` routes no longer answer it). Every Solana Build step takes `transactionSafetyMode` like EVM, and the mode sealed into a Solana Build is on `SvmStagedBuild` / `SvmSimulatedBuild`. `SvmBuild` has `balanceChanges` and `approvals` like `EvmBuild`.
