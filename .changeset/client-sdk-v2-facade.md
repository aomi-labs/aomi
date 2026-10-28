---
"@aomi-labs/client": minor
"@aomi-labs/cli": patch
"@aomi-labs/widget": patch
---

SDK v2 facade, additive. `new Aomi()` (baseUrl defaults to https://chat.aomi.dev) with `auth: oauth({ clientId, store, onCode })` or `bearer(token)`, and `signer: { evm, svm }` (replaces `wallet`).

- `aomi.agent.thread(id?)` → `Thread.send(text)` → `Turn`: await it for `{ reply, commits }`, iterate `turn.steps({ decode? })`, `turn.interrupt()`. `thread.rename()`, `aomi.agent.threads.list()`; `aomi.agent.run()` answers `reply`.
- One `Commit` (`CommitHandle`) for EVM and Solana transactions and messages: `kind`, `state`, `signUrl`, `sign()`, `approve()`, `refresh()`, `settled()` (waits; the old snapshot is `settlement`).
- `aomi.pipeline.build(op, args)`, `operations()`, `invoke()` use the default app unless `{ app }` is given, pick EVM or Solana from the operation and fill `topic`; `build.commit()` answers a Commit. `aomi.pipeline.skills.list()`.
- `aomi.account`: `me()`, `wallets.list/balance`, `apps.install(name)`, `apps.credentials(name).set`, `guard.get/set`, `statement()`, `logins`, `merge()`; merge offers and Retry-After are on the error.
- `AomiError` (`code`, `hint`, `status`) and `isAomiError(e, code?)`.
- Subpaths: `@aomi-labs/client/viem` (`viemSigner`), `@aomi-labs/client/solana` (`solanaSigner`; Solana libraries are now optional peers), `@aomi-labs/client/node` (`fileGrants`).
