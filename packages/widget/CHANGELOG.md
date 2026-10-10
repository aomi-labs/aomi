# @aomi-labs/widget

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
