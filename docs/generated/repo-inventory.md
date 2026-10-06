---
owner: platform
status: authoritative
area: repo-inventory
sources_of_truth:
  - repowiki.toml
  - pnpm-workspace.yaml
review_after_days: 7
---

# Repository Inventory

## Top-Level Directories

- `apps`
- `docs`
- `memory`
- `node_modules`
- `packages`
- `public`
- `scripts`
- `specs`
- `src`

## PNPM Workspace Packages

- `.`
- `apps/base`
- `apps/build`
- `examples/headless`
- `apps/landing`
- `apps/portal`
- `packages/widget`
- `apps/telegram`
- `examples/embed-vite`
- `packages/account`
- `packages/observability`
- `packages/client`
- `packages/deploy`
- `packages/react`
- `packages/service`
- `packages/smither`

## Area Maps

- `development` owners: platform, frontend | code globs: package.json, pnpm-workspace.yaml, scripts/\*\*, apps/landing/package.json, packages/widget/package.json, packages/client/package.json, packages/react/package.json | docs globs: docs/topics/development/facts/workspace.md, docs/local-dev-stack.md
- `apps` owners: frontend | code globs: apps/base/**, apps/landing/**, apps/portal/**, apps/telegram/**, packages/widget/src/frame/aomi-frame.tsx, packages/widget/src/components/assistant-ui/**, packages/widget/src/components/control-bar/**, packages/widget/src/host-composition.ts, packages/widget/src/index.ts, src/components/assistant-ui/runtime.tsx | docs globs: docs/topics/apps/facts/app-surfaces.md, docs/topics/apps/facts/widget-frame.md
- `client-runtime` owners: frontend, sdk | code globs: packages/react/src/contexts/**, packages/react/src/handlers/**, packages/react/src/interface.tsx, packages/react/src/runtime/**, packages/react/src/state/**, packages/react/src/utils/**, packages/client/bin/**, packages/client/src/cli.ts, packages/client/src/cli/\*\*, packages/client/src/client.ts, packages/client/src/event.ts, packages/client/src/index.ts, packages/client/src/session.ts, packages/client/src/sse.ts, packages/client/src/types.ts | docs globs: docs/topics/client-runtime/facts/react-runtime.md, docs/topics/client-runtime/facts/transport-client.md, docs/topics/client-runtime/facts/cli.md
- `auth` owners: frontend | code globs: packages/account/**, apps/portal/src/app/api/auth/**, apps/portal/src/lib/aomi-account/**, packages/widget/src/lib/wallet-kit/**, packages/react/src/runtime/user-state-provider.tsx | docs globs: docs/topics/auth/facts/auth.md, docs/topics/auth/facts/wallet-kit.md, docs/topics/auth/facts/base-account.md
