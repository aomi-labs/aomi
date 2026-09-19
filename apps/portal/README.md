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

A Next.js client for Aomi Agent sessions, Actions, and settings/account flows.

## Current Shape

- `src/components/shell/portal-aomi-frame.tsx` is the Portal shell entrypoint.
- `@aomi-labs/react` projects one `ClientSession` snapshot per selected thread.
- The core `ActionHandler` owns Action execution and response state; wallet-kit
  adapters expose only primitive send, sign, and switch capabilities.
- `src/app/v1/agent/*` and `src/app/v1/pipeline/*` are authenticated BFF
  boundaries over the Rust-owned public protocols.

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

   Local development defaults to `http://127.0.0.1:8080`. Vercel production defaults to `https://api.aomi.dev`; previews default to `https://api-staging.aomi.dev`. For local full-stack startup use [../scripts/dev.sh](../scripts/dev.sh).

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

## Local E2E

The repository includes both protocol and rendered browser coverage:

- `scripts/agent-cutover-e2e.mts` exercises the ordered Agent Event/Action
  protocol against a local backend.
- `tests/e2e/local-agent-cutover.spec.ts` exercises Portal → BFF → Agent API →
  wallet capability → Action response → terminal lifecycle with Playwright.
- Use `scripts/dev.sh` from the paired backend checkout to launch the exact
  frontend/backend worktrees together.

## Commands

- `pnpm dev` - start the development server
- `pnpm dev:localhost` - force localhost-style local runtime URLs
- `pnpm build` - Build for production
- `pnpm test` - run frontend tests
- `pnpm lint` - run ESLint
- `pnpm type-check` - run Next type generation and TypeScript checking

## Related Docs

- [../docs/topics/frontend-e2e.md](../docs/topics/frontend-e2e.md)
- [../docs/topics/tool-flow.md](../docs/topics/tool-flow.md)
- [../docs/topics/auth.md](../docs/topics/auth.md)
