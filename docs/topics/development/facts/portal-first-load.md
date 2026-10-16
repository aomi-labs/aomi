---
title: Portal first-load script budget
owner: frontend
status: maintained
area: development
sources_of_truth:
  - scripts/performance/capture-ui.ts
  - tests/contracts/walletconnect-modal.test.mjs
  - patches/@walletconnect__ethereum-provider@2.21.1.patch
---

# Portal first-load script budget

The production packed-consumer job enforces 1,200 KiB (1,228,800 gzip bytes).
The capture uses fresh browsers and anonymous sessions; only agent traffic is
faked. Wallet, account and UI code are real.

## WalletConnect QR initialization

On main `df389fb2`, the same Portal build measured 1,193,130 bytes before
four async WalletConnect/AppKit UI chunks finished, or 1,258,967 afterward.
The four chunks total 65,837 bytes. Composer readiness is not evidence that
wallet initialization has finished. Base-main CI run 38701495015 and PR #751
run 38914023473 both captured the latter size.

Wagmi's WalletConnect setup calls `getProvider()` even without a connection.
EthereumProvider 2.21.1 restores the session and then creates AppKit whenever
`showQrModal` is true. AppKit brings in QR UI during this startup, although no
pairing UI has been requested.

The version-bound pnpm patch moves that existing modal creation block to
`initializeModal()`, called before `connect()` and `authenticate()`. Provider
and persisted-session initialization are unchanged. The original modal,
options, event handlers and pairing code remain in use. `showQrModal:false`
remains headless. Both browser ESM and CommonJS entrypoints are patched.

This workspace patch is not injected into published Aomi package tarballs;
external consumers choose and install their own dependencies. No public Aomi
API or wallet connector policy changes.

## Measurement and maintenance

After composer readiness, the capture observes at least two seconds, then
waits for pending scripts to finish and 500 ms without another script request.
It fails if scripts do not settle within ten seconds. The count includes the
union of script requests and completed Performance resource entries, with the
same Next.js static-file scope and unchanged budget. Wallet requests are not
excluded.

`tests/contracts/walletconnect-modal.test.mjs` exercises the installed provider
build with controlled relay and modal boundaries. It verifies cold/restored
initialization, pairing, modal reuse, cancellation, authenticate and headless
mode. Full production cold loads and wallet journeys run in Packed Consumers.
The same runner also executes `scripts/performance/check-walletconnect-qr.mjs`:
three fresh browsers render the real installed ESM provider and AppKit, verify
the exact QR URI, and pair/cancel twice each. Only the relay and remote optional
metadata are controlled; UI scripts are bundled from the installed packages.

When upgrading EthereumProvider, inspect upstream modal initialization and
remove the patch if the same lazy behavior is available upstream. Do not
silently carry it to an unreviewed provider version. Frozen installs verify
its version and hash.
