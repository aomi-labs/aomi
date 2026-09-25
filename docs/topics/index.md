---
title: Repo Wiki Topics
owner: platform
status: authoritative
area: repowiki
review_after_days: 30
sources_of_truth:
  - repowiki.toml
  - docs/topics
  - scripts/repowiki
---

# Repo Wiki Topics

These topic pages are the maintained knowledge surface for `aomi`. They are organized as semantic topic folders with raw facts under `facts/`; optional diagrams belong under `diagrahm/`, and scratch work belongs under `tmp/`.

Use `./scripts/repowiki list` to enumerate topics and `./scripts/repowiki look <topic>` to open one directly. Topic command handling comes from the neighboring `product-mono` Rust `repowiki` binary; this repo owns the wrapper, config, docs surface, and the local `./aomi` link that lets generated inventories reuse the shared Rust workspace metadata.

## Auth

- [auth/facts/auth.md](auth/facts/auth.md): `@aomi-labs/auth`, portal auth routes, and credential handoff flow
- [auth/facts/wallet-kit.md](auth/facts/wallet-kit.md): auth-provider bridge from host wallets into runtime `UserState`
- [auth/facts/base-account.md](auth/facts/base-account.md): Base Account provider surface

## Apps

- [apps/facts/app-surfaces.md](apps/facts/app-surfaces.md): landing, base, portal, and telegram app surfaces
- [apps/facts/widget-frame.md](apps/facts/widget-frame.md): embeddable Aomi frame composition and UI surface
- [apps/facts/working-trace.md](apps/facts/working-trace.md): shared lifecycle rows, visible tool names, and neutral fallback

## Client Runtime

- [client-runtime/facts/react-runtime.md](client-runtime/facts/react-runtime.md): React provider shell, thread runtime, and event flow
- [client-runtime/facts/transport-client.md](client-runtime/facts/transport-client.md): HTTP, SSE, and shared API types
- [client-runtime/facts/cli.md](client-runtime/facts/cli.md): `aomi` CLI entrypoint and command structure
- [client-runtime/facts/solana-transactions.md](client-runtime/facts/solana-transactions.md): Solana approvals, signing, broadcast, and browser acceptance

## Development

- [development/facts/workspace.md](development/facts/workspace.md): workspace package graph and build flows

## Deploy

- [deploy/facts/projects.md](deploy/facts/projects.md): canonical project types, account/platform read scopes, and removed compatibility surfaces

## Supporting References

- [../index.md](../index.md): repo wiki entrypoint and policy
- [../local-dev-stack.md](../local-dev-stack.md): local BFF/BetterAuth stack setup
- [../../specs/DOMAIN.md](../../specs/DOMAIN.md): architecture rules and flows
- [../../specs/METADATA.md](../../specs/METADATA.md): package and environment metadata
