---
title: Auth Adapter
owner: frontend
status: authoritative
area: auth
review_after_days: 30
sources_of_truth:
  - apps/registry/src/lib/wallet-kit/context.tsx
  - packages/react/src/runtime/user-state-provider.tsx
  - apps/registry/src/lib/wallet-kit/providers/base-account.tsx
  - apps/registry/src/lib/wallet-kit/providers/para.tsx
  - apps/registry/src/lib/wallet-kit/types.ts
---

# Auth Adapter

The wallet kit layer bridges host-specific wallet or account providers into the runtime’s normalized `UserState`.

## Core Behavior

- `AomiWalletKitSync` reads the active adapter identity and mirrors it into `useUser()` state from `@aomi-labs/react`.
- The bridge carries EVM address, optional Solana address, chain id, smart-account mode, and provider labels.
- Adapter metadata is also copied into `user_state.ext` keys such as `wallet_provider` and `login_method`.
- External EVM connections persist and silently reconnect after a page reload by default, independently of the Aomi account session. An explicit wallet disconnect remains disconnected. Solana adapters use their native `autoConnect` restoration.

## Why It Exists

- Host apps can authenticate through different providers without rewriting runtime internals.
- The runtime needs one normalized user model even when the host provider exposes separate EVM and SVM identities.
- Smart-account and login-method metadata need to survive the jump from host adapter code into backend-facing runtime state.

## Current Surface

- Registry-side adapters live under `apps/registry/src/lib/wallet-kit/`.
- Provider-specific implementations currently include Para and Base Account integration surfaces.

## Related Topics

- [apps/facts/widget-frame.md](../../apps/facts/widget-frame.md)
- [client-runtime/facts/react-runtime.md](../../client-runtime/facts/react-runtime.md)
- [auth/facts/auth.md](auth.md)
