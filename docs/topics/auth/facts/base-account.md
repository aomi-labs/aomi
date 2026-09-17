---
title: Base Account Provider
owner: frontend
status: authoritative
area: auth
review_after_days: 30
sources_of_truth:
  - apps/shadcn-registry/src/lib/wallet-kit/config/AomiWalletKitProvider.tsx
  - apps/shadcn-registry/src/lib/wallet-kit/catalog/evm-connector-catalog.ts
---

# Base Account Provider

## Overview

Base Account is an EVM wallet/provider compatibility surface in the widget wallet kit. It is not a BetterAuth login provider and does not create portal sessions by itself.

Configure Base Account through `AomiWalletKitProvider` with
`wallets.evm.wallets = ["baseAccount"]`.

## Source Map

- [apps/shadcn-registry/src/lib/wallet-kit/config/AomiWalletKitProvider.tsx](../../../../apps/shadcn-registry/src/lib/wallet-kit/config/AomiWalletKitProvider.tsx)
- [apps/shadcn-registry/src/lib/wallet-kit/catalog/evm-connector-catalog.ts](../../../../apps/shadcn-registry/src/lib/wallet-kit/catalog/evm-connector-catalog.ts)

## Key Flows

- `AomiWalletKitProvider` resolves the requested EVM chains and forwards Base Account selection to the shared connector catalog.
- The EVM wallet catalog adds the `baseAccount` connector only when requested and passes app metadata through to its connector setup.
- It configures account-abstraction execution as 4337-only, with optional sponsorship passed through the shared wallet-kit execution config.
- Connected Base Account identity is mirrored into runtime `UserState` by the same wallet-kit sync path as other wallet providers.

## Operational Notes

- Keep Base Account on the shared `AomiWalletKitProvider` path alongside Para, Privy, injected EVM wallets, and WalletConnect.
- Base Account wallet connection can make `UserState.is_connected` true, but backend authentication still requires the BetterAuth session path described in [auth.md](auth.md).
- Sponsorship URLs or paymaster credentials must stay in host/server configuration; do not expose secret paymaster material through user state.

## Related Topics

- [auth/facts/wallet-kit.md](wallet-kit.md)
- [auth/facts/auth.md](auth.md)
