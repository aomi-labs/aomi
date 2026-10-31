# @aomi-labs/react

## 1.0.0

### Major Changes

- 665e1dc: Cut over to owner-scoped funding events and one Card / USDC checkout for account and builder credits. Remove top-up and purchase APIs, end-user BYOK options and funding headers. Consumers must upgrade with the backend; no compatibility adapters are provided.

  Builder grants specify canonical model coverage. App metadata carries fundedModelOnly and sponsoredModelIds inline. Hosting charges debit builder credits, separately from personal Chat credits.

  Use the generated CreditBalance and CreditLedger contracts. credits.get() returns only the balance; load history with credits.ledger(). Remove AomiCreditPosition/AomiCreditActivity and export CreditBalance, CreditLedger and CreditLedgerEntry. The shared checkout component is CreditCheckoutDialog.

### Minor Changes

- e7d4c1e: Agent wallets: `AomiRuntimeApi` exposes `activeWallet` and `setThreadWallet(id)`, and the user state carries `wallet_pick`, `wallet_presence` and `active_wallet`. `ThreadMetadata` carries `origin` and `awaitingApproval`; chats started in Telegram stay off the list. Display resources `account-wallets`, `wallet-balance` and `connections`.
- bb9e018: Accept an `account` prop on the runtime provider and keep display persistence per backend, App and account.
- e008a8d: `AomiRuntimeProvider` takes `aomi` or makes one; the display cache's `apiClient` is now `aomi`; `ControlContextProvider` takes `aomi`. `CONTEXT_STEP_TOOL` and `ContextStep` come from `@aomi-labs/client/trace`. React no longer re-exports `AomiClient`, the wallet helpers and types (import them from `@aomi-labs/client`), `cn` (from `@aomi-labs/widget`) or `formatAddress` (use `shortAddress` from `@aomi-labs/client`).
- Clean cutover of the TypeScript reform. Remove legacy widget exports, subpaths,
  auth props and the SDK wallet option; use signer and curated widget entries.
  Remove CLI command aliases and old state migration. Keep saved OAuth device
  identity and isolate interactive conversation transitions. Build APIs use
  /api/build, with one deployments route family. The Build sandbox signer is
  aomi-build with BUILD_SERVICE_PRIVATE_KEY; Edge remains a separate identity.

### Patch Changes

- ea42447: Builders manage a private App's key from Build: `BackendClient.getBuilderAppKey` shows the current key and `regenerateBuilderAppKey` issues a new one, revoking the old. The App key input and the "App key required" notice now point people to the key the App's builder shared.
- b35b714: Prefer GPT-6.1 Sol for new and Auto threads when the backend offers it, preserving manual model selections and existing fallbacks.
- 82be57d: The account chip asks to sign in (or shows "Signing in…") instead of showing a connected wallet that has not signed in. @-mention tags and explorer links sit on the text baseline. Chat titles drop the mention markers. The working trace no longer shows a commit hand-off card; the activity panel shows signing.
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

## 0.9.1

- Use the backend model catalog without adding app-sponsored supplier routes to the general picker. Recover saved supplier selections as the same manual model in the current catalog, preserving the backend's provider routing and the default-model Auto setting.

## 0.8.5

- Publish under the MIT license, with a `repository` link so npm can show build provenance.

## 0.8.2

- Prefer GPT-6.1 Sol for new and Auto threads when available, preserving manual selections and existing fallback models.

## 0.8.1

- Project context compaction events into the message runtime.

## 0.8.0

- Add per-account display caching, controlled thread selection, draft preservation and shared query transport.
- Replace guest transports on wallet sign-in without losing unsent drafts; re-admit expired guests once on a fresh conversation without carrying old history or actions.
- Refresh stale profile and ACL display data on focus, and credits after admitted replies settle, with account and operation ownership fences.
- Keep API credentials in memory by default with an explicit scoped session-storage option.
- Expose stable frame runtime integration without restarting chat during wallet-provider initialization.
