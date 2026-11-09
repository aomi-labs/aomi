# @aomi-labs/widget

## 5.1.7

### Patch Changes

- Wait for native cached messages before completing reader scroll restoration on a first revisit.

## 5.1.6

### Patch Changes

- Restore saved transcript position after initial message layout and close Settings with Escape.

## 5.1.5

### Patch Changes

- Encode the complete EIP-1559 transaction envelope for Para signing so the provider can decode it before review. Preserve the exact prepared transaction and existing review and unknown-outcome safeguards.

## 5.1.4

### Patch Changes

- Show the staged Solana action titles in signing links and the portal sidebar, including saved reviews with generic assembly labels. Compute-budget instructions do not replace the human-readable action name.

## 5.1.3

### Patch Changes

- Signing in or linking a Solana wallet from the wallet sheet works when Phantom is on a different network than Aomi. Phantom won't show a sign-in message whose Chain ID isn't its own network, and wallets don't say which network they're on, so on that refusal the sheet asks again on the next Solana cluster (at most three tries), each time with a fresh nonce bound to that cluster. Any other failure, including the user declining, ends the attempt as before, and a sheet that is closed, restarted, switched to another wallet or unmounted asks no further. Widget wallet-session sign-in is unchanged.

## 5.1.2

### Patch Changes

- Add xStocks and RWA artwork and reuse Jupiter's mark for Jupiter Lend. Library, capability mentions, the picker, and the working trace share the same local icons in both themes.

## 5.1.1

### Patch Changes

- Para embedded wallets sign commit transactions through Para's `signTransaction` with its review callback, and commits use `sign_and_broadcast`: Commit Service stores the signed transaction (nonce pinned) before anything is broadcast. Para's review page opens from a "Review in Para" button, a fresh user gesture, instead of a popup the browser blocks after async work (Para's SDK then waited forever). Signing is bounded; an unfinished signature is reported as not completed, never as a user rejection, and a retry signs the same nonce.

## 5.1.0

### Minor Changes

- 0e96552: A message sent while a turn is working joins that turn. `Session.steer` posts it to `/v1/agent/chat/{sessionId}/steer` and resolves `false` when no turn is running. Portal and the embedded chat keep Send available during a run and split the working trace at the follow-up. The CLI REPL accepts input while a reply streams, and `aomi chat` adds to a running request.

### Patch Changes

- Only a `payment_required` 402 opens the out-of-funds modal. A `builder_debt` 402 says the App is temporarily unavailable until its builder adds funds, and other 402 codes show "App unavailable". A rate-limited guest sign-in (429) throws `GuestSignInError` with `retryAfterSeconds`, ends the pending send instead of leaving the thinking indicator running, and shows "Too many requests" with the wait. The Coinbase Wallet and Base Account connectors pass `preference.telemetry: false`, so the SDKs no longer load Coinbase's analytics script from cca-lite.coinbase.com.
- b08e7a9: Out of funds, the widget opens Add funds checkout in place instead of linking to Chat on another origin, so embedded hosts' visitors top up without leaving the page. A `builder_debt` refusal shows "App paused" instead of asking the user to pay, since their own balance can't fix it.
- Expose explicit live and Stripe sandbox credit funding, show the Base Sepolia payment option, and warn that test payments add spendable credits to the current account balance.
- A send that never started now ends at once. A 503 `app_loading` and a failed guest session check no longer leave the thinking indicator and Stop running. The composer gets the message back and a notice says what happened. A failed guest session check is a `GuestSignInError`. The new notices read "App starting" and "App not available" for a 403 or 404 on a Direct App. In a Direct-only widget the composer keeps a failed message's text: its editor no longer clears the restored draft when it remounts. A finished working trace with a failed step shows a warning and the failed count in its header.
- Updated dependencies
- Updated dependencies [b08e7a9]
- Updated dependencies
- Updated dependencies [0e96552]
- Updated dependencies
  - @aomi-labs/client@1.1.0
  - @aomi-labs/react@1.1.0

## 5.0.3

### Patch Changes

- Remove discarded EVM and Solana drafts from the activity sidebar, including earlier turns, legacy Jupiter drafts and persisted event replay. Show discard count bubbles in the Working trace.

## 5.0.2

### Patch Changes

- Replace Usage settings with Billing and show dollar balances throughout the account UI. Add a stepped card and USDC checkout with optional wallet selection while preserving existing host wallet integrations.
- Subscribe to billing data only while the payment gate is visible, keeping the closed gate out of ordinary chat updates.

## 5.0.1

### Patch Changes

- Updated dependencies
  - @aomi-labs/client@1.0.1
  - @aomi-labs/react@1.0.1

## 5.0.0

### Major Changes

- 665e1dc: Cut over to owner-scoped funding events and one Card / USDC checkout for account and builder credits. Remove top-up and purchase APIs, end-user BYOK options and funding headers. Consumers must upgrade with the backend; no compatibility adapters are provided.

  Builder grants specify canonical model coverage. App metadata carries fundedModelOnly and sponsoredModelIds inline. Hosting charges debit builder credits, separately from personal Chat credits.

  Use the generated CreditBalance and CreditLedger contracts. credits.get() returns only the balance; load history with credits.ledger(). Remove AomiCreditPosition/AomiCreditActivity and export CreditBalance, CreditLedger and CreditLedgerEntry. The shared checkout component is CreditCheckoutDialog.

- Clean cutover of the TypeScript reform. Remove legacy widget exports, subpaths,
  auth props and the SDK wallet option; use signer and curated widget entries.
  Remove CLI command aliases and old state migration. Keep saved OAuth device
  identity and isolate interactive conversation transitions. Build APIs use
  /api/build, with one deployments route family. The Build sandbox signer is
  aomi-build with BUILD_SERVICE_PRIVATE_KEY; Edge remains a separate identity.
- e008a8d: The account shell runs on one `Aomi` and never mints a guest. `ConsentWallets`, `useConsentLanes` and `TelegramLinkPanel` take any `{ account }`. The working trace decodes tool calls with `@aomi-labs/client/trace`, with the same icons and logos. Exports `cn`, which knows the Aomi theme's class names. Removes the deprecated `formatAddress` (use `shortAddress` from `@aomi-labs/client`).

### Minor Changes

- e7d4c1e: Agent wallets in the wallet menu and Settings: create (portal only), rename, pause, archive, deposit (QR) and send. One wallet view (search, kind chips, three rows a page) lists every wallet with each agent wallet's lane (Ask on Aomi, Ask in the client, Instant) on consent, the terminal and Telegram link pages, Settings › Connections and each wallet's "Who can use it"; sign-in wallets show their fixed "Sign in <wallet>". Consent pre-fills a client's lanes and writes nothing when they are unchanged. Sign-in wallets get a Manage sheet (Receive, Rename, who can use it); an address row under a wallet only copies, and the wallet's ⋯ opens with Manage. The sign page puts "Connect <wallet>" in the Submit slot until the signer is connected. Approve in the sidebar and on the sign page (`CommitSignPanel`), which, like send, follows the whole batch. `TelegramLinkPanel` links a Telegram account. Thread rows mark chats started elsewhere (scheduled, MCP/API, CLI/SDK, Telegram, inside an app). Removed: provider-delegated and client-side automatic signing (`usePrivyDelegation`, `PrivyDelegationProvider`).
- da4f7b0: Add an `opening` prop to `AomiFrame.Composer`: while the host opens a saved chat, the thread stays empty instead of showing the new-chat screen. The loading-chat skeleton and its `testIds.skeleton` id are removed; a loading chat now shows nothing until it arrives.
- bb9e018: Add `theme` and `baseUrl` props, load `privyAuth`/`paraAuth` without a provider import, and move host APIs to `./host-composition` and `./frame`. The old main-entry names and `apiUrl` stay as deprecated aliases until 4.0.

### Patch Changes

- 87fccb6: `TRANSACTION_SAFETY_NAMES` gives the guard modes their shared names (Strict, Balanced, Yolo); the widget uses them. The CLI chat screen gains `/guard` and drops `/mode`; chat routes Auto unless `--app` pins an app for a run (`aomi apps use` is gone). `aomi guard` takes strict, balanced or yolo. Concurrent calls that need a wider sign-in share one device approval, and the `/v1` sign-in asks for all the client's scopes.
- b32a534: `modelLabel` moves from the widget into @aomi-labs/client (the widget re-exports it). The CLI chat screen shows model names as the web app does, picks the model and routing from a list, and shows the credits left.
- 391ac57: Allow browser OAuth sessions to retain non-exportable DPoP keys in IndexedDB and restore without interactive authorization. Export the shared account menu, avatar, checkout and widget scope for host composition; support menus below a header control.
- ea42447: Builders manage a private App's key from Build: `BackendClient.getBuilderAppKey` shows the current key and `regenerateBuilderAppKey` issues a new one, revoking the old. The App key input and the "App key required" notice now point people to the key the App's builder shared.
- b35b714: Prefer GPT-6.1 Sol for new and Auto threads when the backend offers it, preserving manual model selections and existing fallbacks.
- 665e1dc: Offer Aomi credit top-ups as the primary out-of-credit recovery action, with BYOK as an alternative. Allow hosts to open the existing top-up dialog after sign-in.
- 48f464b: The model picker groups routed and dated DeepSeek ids under DeepSeek and hides snapshot suffixes in their labels.
- a487c0a: Embedded widgets show the dividers and gaps between list items again (`divide-*`, `space-*`); the scoped reset no longer overrides them.
- 1f3b6a8: A Privy or Para login that opens another account offers its merge once: a token refresh for the same login no longer mints a second offer. Closing the provider's sign-in modal stops the pending spinner on the wallet row.
- 82be57d: The account chip asks to sign in (or shows "Signing in…") instead of showing a connected wallet that has not signed in. @-mention tags and explorer links sit on the text baseline. Chat titles drop the mention markers. The working trace no longer shows a commit hand-off card; the activity panel shows signing.
- 0cab445: Picking a wallet address that another connected app also lists now keeps it active instead of snapping back. A failed pick shows an error, and the row being switched to shows a pending spinner. Settings stays on screen while Privy or Para loads, and their wallet rows are named by the provider with the login's email after the address.
- Updated dependencies [665e1dc]
- Updated dependencies [e7d4c1e]
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
- Updated dependencies [ea42447]
- Updated dependencies [bb9e018]
- Updated dependencies [b35b714]
- Updated dependencies [e008a8d]
- Updated dependencies [ae50dbc]
- Updated dependencies
- Updated dependencies [82be57d]
  - @aomi-labs/client@1.0.0
  - @aomi-labs/react@1.0.0

## 4.0.5

- Use the React runtime's GPT-6.1 Terra preference for Auto, preserving manual selections and the existing fallbacks.

## 4.0.4

- Clarify that Auto uses the default model. Provider routing and fallback remain backend policy for every selected model.

## 3.1.7

- Publish under the MIT license, with a `repository` link so npm can show build provenance.
- Show transactions staged by protocol staging tools (`stage_*`, which return `staged: [records]`) in the working trace and the activity sidebar, with "Stage …" titles. Retired `*_prepare_*` tool names still render in saved threads.

## 3.1.6

- Show transaction history and transaction detail reads in the working trace, with network, transaction, balance-change, and status chips.
- Link transaction-history counterparties to their chain explorers.

## 3.1.2

- Consume the React runtime that prefers GPT-6.1 Sol for new and Auto threads while preserving manual model selections.

## 3.1.1

- Show context compaction progress in the working trace.

## 3.1.0

- Publish the canonical compiled widget with one required applicationId prop and browser wallets by default.
- Pin package-controlled pre-1 dependencies to the tested wallet adapter, class utility and icon versions.
- Isolate styles, themes, overlays and notifications per instance; load Para or Privy only through the selected provider island.
- Preserve chat, thread drafts, controlled selection and account state through provider initialization and thread switches.
- Retain the reader's expanded trace on revisits and keep account-menu updates stable when credits resolve.
- Prepare guest auth on composer interaction, share the first send's pending preparation, and keep private profile reads behind a confirmed account.
- Scope browser preferences by backend, App and account; keep API keys out of plaintext local storage.
- Include Solana recovery and the default payment signer, and leave backend AA provisioning to explicit hosts.
- `auth={privyAuth(…)}` and `auth={paraAuth(…)}` load their SDK on demand from the main entry; no provider import is needed, and a missing SDK package shows a message inside the widget. Para defaults to PROD.
- Add `theme` and `baseUrl` (`apiUrl` stays as a deprecated alias); accept a numeric `applicationId`; show invalid props as a message inside the widget; keep the host's `style.transform`.
- The main entry exports the widget, its types, the auth helpers and `preloadWalletProvider`. Other names stay as deprecated aliases until 4.0; host APIs move to `./host-composition`.
- Deprecate `./aomi-widget`, `./aomi-frame`, `./hooks/*`, `./components/*` and the raw `./themes/*.css` source until 4.0.
