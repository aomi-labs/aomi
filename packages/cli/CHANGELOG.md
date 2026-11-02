# @aomi-labs/cli

## 1.0.1

### Patch Changes

- Updated dependencies
  - @aomi-labs/client@1.0.1

## 1.0.0

### Major Changes

- 665e1dc: Cut over to owner-scoped funding events and one Card / USDC checkout for account and builder credits. Remove top-up and purchase APIs, end-user BYOK options and funding headers. Consumers must upgrade with the backend; no compatibility adapters are provided.

  Builder grants specify canonical model coverage. App metadata carries fundedModelOnly and sponsoredModelIds inline. Hosting charges debit builder credits, separately from personal Chat credits.

  Use the generated CreditBalance and CreditLedger contracts. credits.get() returns only the balance; load history with credits.ledger(). Remove AomiCreditPosition/AomiCreditActivity and export CreditBalance, CreditLedger and CreditLedgerEntry. The shared checkout component is CreditCheckoutDialog.

### Minor Changes

- e7d4c1e: `aomi tx show <ref>` and `aomi tx approve <ref>`: approving works from your normal `aomi account login` for wallets where this terminal is set to "Ask in" (the default at sign-in) and waits until every transfer in the batch is done. `aomi wallets [use <id>]` lists and switches the chat's wallet.
- ab755c8: The CLI runs on `new Aomi()`. Commands are Stricli (`aomi --help` shows the tree; `--help-all` the hidden flags; old paths such as `session`, `wallet`, `app` and `account login` are aliases). Sign-in is `aomi login` (one device code) or `--private-key` (SIWE, also the signer); the provider loopback, wallet login, `--account-bearer` and session swaps are gone. `aomi -p` prints the reply on stdout and the decoded trace on stderr, `--json` prints NDJSON, and exit codes mean something (2 usage, 3 waiting for you). `aomi` opens a pi-tui chat screen. `--chain` takes decimal ids only. Removed: `tx simulate`, `tx submit`, `tx preflight`, the EIP-5792/MetaMask Action exports and the raw Pipeline lifecycle commands.
- Clean cutover of the TypeScript reform. Remove legacy widget exports, subpaths,
  auth props and the SDK wallet option; use signer and curated widget entries.
  Remove CLI command aliases and old state migration. Keep saved OAuth device
  identity and isolate interactive conversation transitions. Build APIs use
  /api/build, with one deployments route family. The Build sandbox signer is
  aomi-build with BUILD_SERVICE_PRIVATE_KEY; Edge remains a separate identity.

### Patch Changes

- 87fccb6: `TRANSACTION_SAFETY_NAMES` gives the guard modes their shared names (Strict, Balanced, Yolo); the widget uses them. The CLI chat screen gains `/guard` and drops `/mode`; chat routes Auto unless `--app` pins an app for a run (`aomi apps use` is gone). `aomi guard` takes strict, balanced or yolo. Concurrent calls that need a wider sign-in share one device approval, and the `/v1` sign-in asks for all the client's scopes.
- d57aa02: Send the configured Portal URL's HTTP origin on CLI SIWE and SIWS nonce and verification requests, so staging Edge forwarding preserves the public wallet-login domain. Direct preview and localhost sign-in retain their own origins.
- 61c8882: `thread.history()` returns what was said in a thread and its active wallet; `aomi.account.wallets.use(id, { thread })` switches a thread's wallet. The CLI chat screen renders replies as markdown, shows a thread's history when it continues one, adds `/threads` to continue another and `/wallet` to pick the thread's wallet (each described by how it signs), and shows that wallet in the status bar. `aomi wallets` gains a SIGNS column and `aomi threads show` prints a thread.
- b32a534: `modelLabel` moves from the widget into @aomi-labs/client (the widget re-exports it). The CLI chat screen shows model names as the web app does, picks the model and routing from a list, and shows the credits left.
- 7a071dd: Read simulation step evidence under `result` as well as `execution`, so passed batches no longer render as failed with zero gas.
- ae50dbc: `thread.history()` also returns the thread turn by turn (your message, its tool calls, the agent's replies, working time) and takes `{ decode }` like `turn.steps()`. The CLI chat screen shows past turns with their steps, and links are clickable.
- Updated dependencies [665e1dc]
- Updated dependencies [e7d4c1e]
- Updated dependencies [87fccb6]
- Updated dependencies [61c8882]
- Updated dependencies [bb9e018]
- Updated dependencies [fd0c2aa]
- Updated dependencies [b32a534]
- Updated dependencies [7a5e7d8]
- Updated dependencies [e008a8d]
- Updated dependencies [7a071dd]
- Updated dependencies [391ac57]
- Updated dependencies [ae50dbc]
- Updated dependencies
  - @aomi-labs/client@1.0.0

## 0.1.2

- Add `tx preflight`, a read-only check of which catalogued wallets can fund an exact ERC-20 transfer on their own chains, including native gas. It never signs.
- Report the effective connection origin and its configuration source with `aomi config current`, without exposing credentials or requiring a signing key.
- Document staging and Portal/BFF configuration and the Commit review, signing and retry flow.
- Validate a clean CLI install alongside the client migration shim, and from the public registry after publication.

## 0.1.1

- Read simulation step evidence under `result` as well as `execution`, so passed batches no longer render as failed with zero gas.

## 0.1.0

- Publish the CLI independently as @aomi-labs/cli while retaining compatibility forwarding from the client package.
- Pin the command parser to its tested pre-1 release.
- Share account graph and project transport with the public client, including typed HTTP failures.
- Read and update account or thread guard policy using the backend's authoritative revision.
- Keep headless signing, execution and payment capabilities aligned with the widget runtime.
