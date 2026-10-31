---
title: App Surfaces
owner: frontend
status: authoritative
area: apps
review_after_days: 30
sources_of_truth:
  - package.json
  - apps/build/package.json
  - apps/edge/package.json
  - apps/landing/package.json
  - apps/portal/package.json
---

# App Surfaces

The app surfaces in `apps/` are the main product and validation targets for package changes.

## Main Surfaces

- `apps/landing` is the primary marketing and docs surface, and the root `dev` workflow points at it.
- `apps/portal` is the chat portal: TanStack Start pages only, with its own lint, type-check, and test commands. Its server routes live in `apps/edge`.
- `apps/build` is the Aomi Build control plane (TanStack Start).
- `apps/edge` is the Cloudflare Worker that serves auth, account, the proxy and the Build BFF.

## Common Workflows

- `pnpm --filter landing dev` runs the main demo app.
- `pnpm run dev:landing:live` watches the shared library while serving the landing app.
- `pnpm run check:apps` is the cross-app validation path wired at the root package level.

## Operational Notes

- These app surfaces depend on workspace packages instead of published versions.
- Changes in `packages/react`, `packages/client`, or `packages/widget`
  should generally be checked in at least one app surface before release.

## Related Topics

- [development/facts/workspace.md](../../development/facts/workspace.md)
- [apps/facts/widget-frame.md](../../apps/facts/widget-frame.md)
