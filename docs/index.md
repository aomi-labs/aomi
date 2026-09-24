---
title: Repo Wiki Index
owner: platform
status: authoritative
area: repowiki
review_after_days: 30
sources_of_truth:
  - repowiki.toml
  - docs/topics
  - scripts/repowiki
  - specs/DOMAIN.md
  - specs/METADATA.md
---

# Repo Wiki Index

`docs/` is the maintained knowledge surface for `aomi`. Topic folders capture durable implementation knowledge under `facts/`, while generated inventories support discovery and ownership lookup.

## Primary Entry Points

- `./scripts/repowiki list`: list maintained topic docs
- `./scripts/repowiki look <topic>`: open a maintained topic doc by slug
- `./scripts/repowiki search "<query>"`: search indexed docs once `refresh` or `index` has been run
- [topics/index.md](topics/index.md): curated topic list
- [generated/repo-inventory.md](generated/repo-inventory.md): generated workspace inventory
- [generated/markdown-inventory.md](generated/markdown-inventory.md): generated markdown inventory
- [local-dev-stack.md](local-dev-stack.md): local BFF/BetterAuth stack setup
- [../specs/DOMAIN.md](../specs/DOMAIN.md): architecture and runtime invariants
- [../specs/METADATA.md](../specs/METADATA.md): environment and package reference

## Topic Set

- auth: [topics/auth/facts/auth.md](topics/auth/facts/auth.md), [topics/auth/facts/wallet-kit.md](topics/auth/facts/wallet-kit.md), [topics/auth/facts/base-account.md](topics/auth/facts/base-account.md)
- apps: [topics/apps/facts/app-surfaces.md](topics/apps/facts/app-surfaces.md), [topics/apps/facts/widget-frame.md](topics/apps/facts/widget-frame.md), [topics/apps/facts/working-trace.md](topics/apps/facts/working-trace.md)
- bff: [topics/bff/facts/endpoints.md](topics/bff/facts/endpoints.md)
- client-runtime: [topics/client-runtime/facts/react-runtime.md](topics/client-runtime/facts/react-runtime.md), [topics/client-runtime/facts/transport-client.md](topics/client-runtime/facts/transport-client.md), [topics/client-runtime/facts/cli.md](topics/client-runtime/facts/cli.md), [topics/client-runtime/facts/solana-transactions.md](topics/client-runtime/facts/solana-transactions.md)
- development: [topics/development/facts/workspace.md](topics/development/facts/workspace.md)
- deploy: [topics/deploy/facts/projects.md](topics/deploy/facts/projects.md)

## Policy

- Durable repo knowledge belongs in `docs/topics/<topic>/facts/`.
- Use `./scripts/repowiki add <topic>` and `./scripts/repowiki update <topic>` to expand or refresh topic docs.
- Search results are only meaningful after `./scripts/repowiki refresh` or `./scripts/repowiki index`.
- The wrapper in `scripts/repowiki` assumes `product-mono` lives next to this repo, provides the Rust `repowiki` binary, and exposes that Rust workspace locally through `./aomi` when needed by generated docs.
