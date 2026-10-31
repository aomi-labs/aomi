# @aomi-labs/client

## 1.0.0

### Major Changes

- 665e1dc: Cut over to owner-scoped funding events and one Card / USDC checkout for account and builder credits. Remove top-up and purchase APIs, end-user BYOK options and funding headers. Consumers must upgrade with the backend; no compatibility adapters are provided.

  Builder grants specify canonical model coverage. App metadata carries fundedModelOnly and sponsoredModelIds inline. Hosting charges debit builder credits, separately from personal Chat credits.

  Use the generated CreditBalance and CreditLedger contracts. credits.get() returns only the balance; load history with credits.ledger(). Remove AomiCreditPosition/AomiCreditActivity and export CreditBalance, CreditLedger and CreditLedgerEntry. The shared checkout component is CreditCheckoutDialog.

- fd0c2aa: Remove the `aomi` bin from @aomi-labs/client. The command ships in @aomi-labs/cli; install that package instead.

### Minor Changes

- e7d4c1e: Agent wallets and approvals.
  - `client.account.wallets`: `listWallets()` (every wallet the account owns; an agent key carries `agent_wallet_id` and `maker_app`, a browser one `browser_app`), `agentWallets()` (`{pause_all, wallets}`), `createAgentWallet`, `updateAgentWallet` (rename, pause, archive), `agentWalletBalances`, `withdrawAgentWallet`, `pauseAll(paused)` (`PUT /v1/account/pause-all`) and `setThreadWallet(threadId, id)`. Failures are `AomiWalletError`; wallet ids are `w_<id>` (`walletRef`, `parseWalletRef`).
  - `client.account.connections`: list, label (`setConnectionSettings(key, {label?})`), lanes (`setConnectionWallets(key, {wallets: [{id, lane}], application?, new_app_wallet?: {lane}, ask_only?})`) and disconnect. Every connection sees every wallet; an `AomiLane` says who finishes its trade from an agent wallet: `portal` (you approve on Aomi), `here` (it approves its own) or `instant`. `ask_only` caps every lane at `portal`. `listWallets()` entries carry the caller's `lane`.
  - `client.account.link`: preview, confirm and cancel a one-time link code for a platform account (`previewLink("telegram", code)`; `LinkError`, `isLinkCode`).
  - `aomi.commits.get(ref)` opens a commit without a thread (`CommitHandle`: `view`, `review`, `refresh()`, `sign()`, `approve()`, `reject()`). It loads every member of the commit's batch; `batch` lists them and `settled` says when the whole operation is over. Writes name the reviewed version and digest (`CommitStaleError`); `CommitNotFoundError`, `CommitApprovalForbiddenError`, `CommitExpiredError`, `CommitNotAwaitingApprovalError`.
  - `CommitView` gains the `awaiting_approval` state and `approval`; `CommitRefView` gains `can_approve` and `sign_url`.
  - Removed: client-side automatic signing (`beginPrivyDelegation`, `client_auto`).

- 87fccb6: `TRANSACTION_SAFETY_NAMES` gives the guard modes their shared names (Strict, Balanced, Yolo); the widget uses them. The CLI chat screen gains `/guard` and drops `/mode`; chat routes Auto unless `--app` pins an app for a run (`aomi apps use` is gone). `aomi guard` takes strict, balanced or yolo. Concurrent calls that need a wider sign-in share one device approval, and the `/v1` sign-in asks for all the client's scopes.
- 61c8882: `thread.history()` returns what was said in a thread and its active wallet; `aomi.account.wallets.use(id, { thread })` switches a thread's wallet. The CLI chat screen renders replies as markdown, shows a thread's history when it continues one, adds `/threads` to continue another and `/wallet` to pick the thread's wallet (each described by how it signs), and shows that wallet in the status bar. `aomi wallets` gains a SIGNS column and `aomi threads show` prints a thread.
- bb9e018: Declare `better-auth` as an optional peer for the browser-auth entry.
- b32a534: `modelLabel` moves from the widget into @aomi-labs/client (the widget re-exports it). The CLI chat screen shows model names as the web app does, picks the model and routing from a list, and shows the credits left.
- e008a8d: SDK v2 facade, additive. `new Aomi()` (baseUrl defaults to https://chat.aomi.dev) with `auth: oauth({ clientId, store, onCode, scopes? })`, `bearer(token)` or `wallet(account)` (SIWE with an EVM key, for bots and scripts), `cookieSession` for first-party pages, and `signer: { evm, svm }` (replaces `wallet`). The device flow registers a public client (`clientName`) when no `clientId` is given.
  - `aomi.agent.thread(id?)` → `Thread.send(text)` → `Turn`: await it for `{ state, reply, commits }` (a failed turn rejects with `turn_failed`), iterate `turn.steps({ decode? })`, `turn.interrupt()`. `thread.rename()`, `aomi.agent.threads.list()`; `aomi.agent.run()` answers `reply`.
  - One `Commit` (`CommitHandle`) for EVM and Solana transactions and messages: `kind`, `state`, `signUrl`, `sign()` and `approve()` (at the version you were handed or reviewed), `refresh()`, `settled()` (waits; rejects with `CommitSettleError`; the snapshot is `settlement`).
  - `aomi.pipeline.build(op, args)`, `operations()`, `invoke()` use the default app unless `{ app }` is given, pick EVM or Solana from the operation and fill `topic`; for EVM, `build.commit()` answers a Commit. Solana builds review and simulate only (`commit()` throws `svm_commit_unavailable`). `aomi.pipeline.skills.list()`.
  - `aomi.account`: `me()`, `wallets.list/balance`, `apps.install/uninstall` and `apps.credentials(name).set/save/clear` (by name or application id), `guard.get/set` (with `revision`), `statement()`, `logins`, `merge()` (offers and Retry-After are on the error), `keys` (the BYOK and secrets vault, `/v1/account/keys`), `policies` (on-chain Swig policies), `switchTo(ticket)`, SIWE/SIWS nonce and verify, Solana wallet links, `exchangeProviderCredential(c, { newSession })` and `grantDeviceLink()` (a Privy or Para credential for the CLI's one-time device-link code). `aomi.builder.credits`.
  - `AomiError` (`code`, `hint`, `status`) and `isAomiError(e, code?)`. `AccountGraphApiError` messages are the server's message or code.
  - `AomiClient`'s secret methods use `/v1/account/keys`; `AomiClient.resolveAppKey(key)` and `addAccountApp(…, { apiKey })`. An `x402` client is kept when there is no signer.
  - Subpaths: `@aomi-labs/client/viem` (`viemSigner`), `@aomi-labs/client/solana` (`solanaSigner`; Solana libraries are now optional peers), `@aomi-labs/client/node` (`fileGrants`), and `@aomi-labs/client/trace`, the React-free trace decoder: `decode(step)` turns a tool call into a title, chips, status and icon key; `traceFromEvents(events)` groups one turn into notes, steps, delegated agents, context steps and folded `read_tool_output` reads. Icons are string keys (`"swap"`, `"simulate"`, `chain:8453`), so each renderer picks its own glyphs. The root entry does not import it.

- 391ac57: Allow browser OAuth sessions to retain non-exportable DPoP keys in IndexedDB and restore without interactive authorization. Export the shared account menu, avatar, checkout and widget scope for host composition; support menus below a header control.
- ae50dbc: `thread.history()` also returns the thread turn by turn (your message, its tool calls, the agent's replies, working time) and takes `{ decode }` like `turn.steps()`. The CLI chat screen shows past turns with their steps, and links are clickable.
- Clean cutover of the TypeScript reform. Remove legacy widget exports, subpaths,
  auth props and the SDK wallet option; use signer and curated widget entries.
  Remove CLI command aliases and old state migration. Keep saved OAuth device
  identity and isolate interactive conversation transitions. Build APIs use
  /api/build, with one deployments route family. The Build sandbox signer is
  aomi-build with BUILD_SERVICE_PRIVATE_KEY; Edge remains a separate identity.

### Patch Changes

- 7a5e7d8: Refreshing an OAuth grant keeps all its scopes. A refresh made for one call used to save a token for only that call's scopes, so the next call needing another scope started a new sign-in.
- 7a071dd: Read simulation step evidence under `result` as well as `execution`, so passed batches no longer render as failed with zero gas.

## 0.10.6

- Report the origin and route for failed guest sign-in, with Portal/BFF recovery guidance for backend-origin 404s and no credential-bearing URL details.

## 0.10.4

- Publish under the MIT license, with a `repository` link so npm can show build provenance.

## 0.10.3

- Read simulation step evidence under `result` as well as `execution`, so passed batches no longer render as failed with zero gas.

## 0.10.1

- Expose typed context budget and compaction events.

## 0.10.0

- Prepare guest sessions on first composer interaction and join preparation before the first send; retain existing cookies and explicit account credentials.
- Fence anonymous conversation requests when renewal returns a different guest identity; keep backend ownership checks authoritative.

- Keep Better Auth core aligned with the auth and OAuth client release so strict fresh npm installs resolve compatible fetch peers.

- Add shared account graph and project transport, structured fetch errors and scoped browser storage.
- Emit stable public UserState declarations and a browser authentication entry; move the CLI to its own package.

## 0.7.5

- Normalize backend-owned Library `feature_catalog` and registration metadata
  while keeping same-name hosted apps distinct by application ID.

## 0.7.4

- Correct Arc Testnet native-currency metadata to 18 decimals, matching the
  chain RPC and wallet network configuration.

## 0.7.0

Pipeline contract correction and transaction routing surfaces.

### Breaking

- Pipeline Build values are version 2. `EvmStagedBuild`, `EvmSimulatedBuild`,
  `SvmStagedBuild`, and `SvmSimulatedBuild` now carry the server's native
  action records plus `origin`, `expiresAt`, `digest`, and `attestation`.
  Pass the complete value through simulate and commit; do not reconstruct it.
- Removed `EvmStagedAction`, `SvmStagedAction`, `EvmPresentedAction`,
  `SvmPresentedAction`, and `PipelineTransactionReceipt`. Commit results are
  `PipelineEvmCommitResult` / `PipelineSvmCommitResult` with `result` or
  `results` plus `requests`; commit never manufactures a wallet Action.
- `pipeline.evm.stage` rejects a per-call `from`; `pipeline.svm.stage` rejects
  `cluster`/`feePayer` overrides and non-base64 instruction data.
- CLI: `--aa-provider` and `--aa-mode` are rejected. `--aa` and `--eoa` only
  assert the kind of an already-prepared Action; `--eoa` rejects only a
  backend-prepared AA owner authorization and passes ordinary, permit, and
  Solana Actions through.

### Added

- `UserState.route(state, profile)` selects the submitter before a turn: Auto
  with an active delegation defaults to `hosted` (an explicit `venue` stays).
  It never throws; the backend commit gate is the authority.
- `UserState.sameAddress` (case-insensitive EVM, exact SVM).
- `userState.evm.broadcaster` / `userState.svm.broadcaster` (`wallet` |
  `hosted` | `venue`) on the Agent API contract.
- CLI `--solana-public-key` selects an exact SVM account without its key.
- Typed SVM Build actions: `SvmBuildAction` (tagged by `lane`),
  `AssembledSvmInstruction`, `SvmAssembledAccountMeta`; `PipelineActionSummary`
  is a structural interface again.
