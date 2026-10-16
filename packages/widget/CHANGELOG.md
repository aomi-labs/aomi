# @aomi-labs/widget

## 3.1.11

- Link Telegram: `TelegramLinkPanel` for the portal's `/link/telegram` page; Settings › Account lists the linked Telegram under Social sign-in and marks the extra agent wallet the Telegram bots keep using; Connected apps explains /link; merges that wait on a trade or a running link say so.

## 3.1.9

- Approvals: a parked agent-wallet commit shows Approve ("Approve all N" for a batch) and Reject in the sidebar and on the sign page, with no wallet step; embeds link to "Approve on Aomi" instead. An expired approval offers Retry. Chats with a trade waiting for approval keep an amber dot, and a scheduled run's waiting trade shows in its parent chat. Settings › Safety now has one compact card per agent wallet (Pause, Ask always on, Instant per client), a Locked wallets list with Unlock for legacy locked keys, and Connected apps with Disconnect; the per-wallet Ask me / Locked choice is gone. The agent wallet menu gains "Signing rule".

## 3.1.8

- Refresh the canonical inventory after agent wallet creation, bind withdrawals to the selected wallet, and select agent networks without local wallet prompts.

## 3.1.7

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
