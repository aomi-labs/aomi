---
title: Base Account Provider
owner: frontend
status: authoritative
area: auth
review_after_days: 30
sources_of_truth:
  - apps/registry/src/lib/wallet-kit/providers/base-account.tsx
  - apps/registry/src/lib/wallet-kit/config/AomiWalletKitProvider.tsx
  - apps/registry/src/lib/wallet-kit/catalog/evm-connector-catalog.ts
---

# Base Account Provider

## Overview

Base Account is an EVM wallet/provider compatibility surface in the widget wallet kit. It is not a BetterAuth login provider and does not create portal sessions by itself.

New integrations should configure Base Account through `AomiWalletKitProvider` with `wallets.evm.wallets = ["baseAccount"]`. `AomiBaseAccountProvider` remains only as a deprecated wrapper for older consumers.

## Source Map

- [apps/registry/src/lib/wallet-kit/providers/base-account.tsx](../../../../apps/registry/src/lib/wallet-kit/providers/base-account.tsx)
- [apps/registry/src/lib/wallet-kit/config/AomiWalletKitProvider.tsx](../../../../apps/registry/src/lib/wallet-kit/config/AomiWalletKitProvider.tsx)
- [apps/registry/src/lib/wallet-kit/catalog/evm-connector-catalog.ts](../../../../apps/registry/src/lib/wallet-kit/catalog/evm-connector-catalog.ts)

## Key Flows

- The deprecated wrapper resolves the requested Base chains, defaults to Base mainnet, optionally adds Base Sepolia, and forwards to `AomiWalletKitProvider`.
- It configures the EVM wallet catalog with only the `baseAccount` connector, disables Coinbase and Solana wallet options, and passes app metadata through to the connector setup.
- It configures account-abstraction execution as 4337-only, with optional sponsorship passed through the shared wallet-kit execution config.
- Connected Base Account identity is mirrored into runtime `UserState` by the same wallet-kit sync path as other wallet providers.

## Operational Notes

- Treat `AomiBaseAccountProvider` as compatibility-only. Prefer the shared provider config so Base Account stays on the same wallet-kit path as Para, Privy, injected EVM wallets, and WalletConnect.
- Base Account wallet connection can make `UserState.is_connected` true, but backend authentication still requires the BetterAuth session path described in [auth.md](auth.md).
- Sponsorship URLs or paymaster credentials must stay in host/server configuration; do not expose secret paymaster material through user state.

## Related Topics

- [auth/facts/wallet-kit.md](wallet-kit.md)
- [auth/facts/auth.md](auth.md)
