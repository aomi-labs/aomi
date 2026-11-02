---
title: Frontend
owner: frontend
status: reference
area: frontend
review_after_days: 45
sources_of_truth:
  - frontend/src
  - frontend/package.json
---

# Aomi Labs - Frontend

The Aomi chat portal: TanStack Start pages for Agent sessions, Actions, and
settings/account flows. It has no server routes.

## Current Shape

- `src/components/shell/portal-aomi-frame.tsx` is the Portal shell entrypoint.
- `@aomi-labs/react` projects one `ClientSession` snapshot per selected thread.
- The core `ActionHandler` owns Action execution and response state; wallet-kit
  adapters expose only primitive send, sign, and switch capabilities.
- Pages live in `src/routes` (thin) and `src/features`. Every `/api/*`,
  `/v1/*` and `/.well-known/*` path, including sign-in, widget auth, device
  auth and the account graph, is served by the edge Worker (`apps/edge`) on the
  portal host. Pages call it on the same origin.

The durable walkthrough for this workspace lives in [../docs/topics/frontend-e2e.md](../docs/topics/frontend-e2e.md).

## Setup And Development

1. **Install dependencies**:

   ```bash
   pnpm install --frozen-lockfile
   ```

2. **Start development server**:

   ```bash
   pnpm dev
   ```

   `vite dev` serves pages only: run it behind a local Edge (aomi-dev does
   this) so `/api` and `/v1` resolve. Build for Cloudflare with
   `AOMI_DEPLOY_TARGET=cloudflare pnpm build:app` (default: Vercel).

3. **Open in browser**:
   ```
   http://localhost:3000
   ```

## Runtime Wiring

- `PortalAomiFrame` mounts the shared frame and the React runtime.
- `SessionManager` owns one `ClientSession` external store per thread.
- Assistant UI reads canonical messages, lifecycle, tools, tasks, and Actions
  from that session snapshot; it does not maintain a parallel reducer.
- Settings and account surfaces use the canonical `/v1/account/*` BFF.
- Set `AOMI_BUILD_URL` to the Build origin so legacy `/deployments*` routes
  redirect to the same environment.
  Use `https://build-staging.aomi.dev` for the staging Vercel environment and
  your local Build origin (for example, `http://localhost:3001`) for local work.
  It defaults to `https://build.aomi.dev` in production when unset.

## Local E2E

Browser journeys live in `tests/e2e/` and run through Playwright against the
local stack.

- Use `scripts/dev.sh` from the paired backend checkout to launch the exact
  frontend/backend worktrees together.

## Commands

- `pnpm dev` - start the development server
- `pnpm build` - build packages, then the portal (`pnpm build:app` for the portal alone)
- `pnpm start` - preview the production build
- `pnpm test` - run frontend tests
- `pnpm lint` - run ESLint
- `pnpm type-check` - generate the route tree and run TypeScript

## Related Docs

- [../docs/topics/frontend-e2e.md](../docs/topics/frontend-e2e.md)
- [../docs/topics/tool-flow.md](../docs/topics/tool-flow.md)
- [../docs/topics/auth.md](../docs/topics/auth.md)
