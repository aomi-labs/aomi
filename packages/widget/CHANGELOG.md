# @aomi-labs/widget

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
