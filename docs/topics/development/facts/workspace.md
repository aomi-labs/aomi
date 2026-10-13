---
title: Development Workspace
owner: platform
status: authoritative
area: development
review_after_days: 30
sources_of_truth:
  - package.json
  - pnpm-workspace.yaml
  - apps/landing/package.json
  - apps/portal/package.json
  - apps/build/package.json
  - apps/telegram/package.json
  - packages/widget/package.json
  - packages/client/package.json
  - packages/react/package.json
---

# Development Workspace

`aomi` is a pnpm workspace that ships the widget UI, React runtime, TypeScript client, CLI, auth support, and app validation surfaces from one TypeScript repo.

## Workspace Shape

- The root package drives shared scripts for building, linting, typechecking, and running app surfaces.
- `packages/react` publishes `@aomi-labs/react`, the headless runtime and context layer.
- `packages/client` publishes `@aomi-labs/client`, the platform-agnostic client plus the `aomi` CLI binary.
- `packages/widget` publishes `@aomi-labs/widget`, the UI layer and shadcn-style registry surface.
- `apps/landing`, `apps/portal`, `apps/build`, and `apps/telegram` are the deployed app hosts. All four consume workspace packages through TanStack Start, Router, and Query, with Vite and Nitro. Other apps and examples provide validation surfaces.
- `examples/embed-next` and the published compatibility/theme utilities keep their Next integration; they are not deployed app hosts.

## Common Build Flows

- `pnpm run build:client` builds only the client package.
- `pnpm run build:packages` builds/checks the shared package prerequisites, including client, CLI, React runtime, account, deploy, widget, and compatibility packages.
- `pnpm run build:apps` builds all four deployed hosts after shared-package prerequisites.
- `pnpm run typecheck:apps` generates routes and checks each deployed app independently of bundling; Landing also generates Fumadocs MDX sources.
- `pnpm run lint:apps`, `pnpm run test:landing`, `pnpm run test:portal`, and `pnpm run test:telegram` select app checks. Build tests run with `pnpm --filter aomi-build exec vitest run`.
- `pnpm run dev:landing:live` is the quickest end-to-end loop for widget changes because it watches the library while serving the landing app.

## Runtime

Use the repository-pinned pnpm through Corepack and Node.js 22.15+ or 24. Each
app's `dev` serves Vite on `PORT` (default 3000); Node production builds emit
`.output/server/index.mjs` and `.output/public`, and `VERCEL=1` selects Nitro's
Vercel preset. All four deployed hosts use Vite 8.3.4; the root Vitest toolchain stays on Vite 7.3.7.

## Operational Notes

- The repo is package-oriented: core runtime logic lives under `packages/`, while UI and app shells live under `apps/`.
- The root package exposes the `repowiki` wrapper, but the actual CLI implementation stays in neighboring `product-mono`.
- `pnpm-workspace.yaml` keeps the root, `apps/*`, and `packages/*` in the same workspace graph.

## Related Topics

- [apps/facts/widget-frame.md](../../apps/facts/widget-frame.md)
- [client-runtime/facts/react-runtime.md](../../client-runtime/facts/react-runtime.md)
- [client-runtime/facts/transport-client.md](../../client-runtime/facts/transport-client.md)
- [apps/facts/app-surfaces.md](../../apps/facts/app-surfaces.md)
- [frontend-invariants.md](frontend-invariants.md) — protected consumer compatibility and CI ownership.
