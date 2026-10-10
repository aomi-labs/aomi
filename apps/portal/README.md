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

A TanStack Start client for Aomi Agent sessions, Actions, and settings/account flows.

## Current Shape

- `src/components/shell/portal-aomi-frame.tsx` is the Portal shell entrypoint.
- `@aomi-labs/react` projects one `ClientSession` snapshot per selected thread.
- The core `ActionHandler` owns Action execution and response state; wallet-kit
  adapters expose only primitive send, sign, and switch capabilities.
- `src/routes/v1.agent.*` and `src/routes/v1.pipeline.*` are authenticated BFF
  boundaries over the Rust-owned public protocols.

The durable walkthrough for this workspace lives in [frontend E2E](../../docs/topics/development/facts/frontend-invariants.md).

## Setup And Development

1. **Install dependencies**:

   ```bash
   pnpm install --frozen-lockfile
   ```

2. **Start development server**:

   ```bash
   pnpm dev
   ```

   Local development defaults to `http://127.0.0.1:8080`. Vercel production defaults to `https://api.aomi.dev`; previews default to `https://api-staging.aomi.dev`. Use the paired `aomi-dev` workspace for local full-stack startup.

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
- Agent and Pipeline REST/MCP routes use the same-origin BFF. Set the server-only
  `AOMI_AGENT_API_URL` to the Rust api-server origin (`http://127.0.0.1:8082`
  locally, `https://agent-staging-tunnel.aomi.dev` for staging, and
  `https://agent-tunnel.aomi.dev` for production). Hosted builds fail closed
  when this value is absent. Portal authenticates and delegates these routes;
  the Rust api-server is their only protocol presenter.

- Set the server-only `AOMI_BUILD_URL` to the Build origin before building
  Portal so legacy `/deployments*` routes redirect to the same environment.
  Use `https://build-staging.aomi.dev` for the staging Vercel environment and
  your local Build origin (for example, `http://localhost:3001`) for local work.
  It defaults to `https://build.aomi.dev` in production when unset.

## Local E2E

Browser journeys live in `tests/e2e/` and run through Playwright against the
local stack.

- Use `aomi-dev up <workspace>` to launch the exact paired worktrees.

## Commands

- `pnpm dev` - start the development server
- `pnpm dev:localhost` - force localhost-style local runtime URLs
- `pnpm build` - Build for production
- `pnpm test` - run frontend tests
- `pnpm lint` - run ESLint
- `pnpm type-check` - generate Router routes and check TypeScript

## Related Docs

- [frontend E2E](../../docs/topics/development/facts/frontend-invariants.md)
- [Migration verification](../../docs/testing/tanstack-migration.md)
- [Frontend invariants](../../docs/topics/development/facts/frontend-invariants.md)
