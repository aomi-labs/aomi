# Local Dev Stack

This is the quick path for testing the merged `codex/merge-bff-betterauth`
portal in this repo against the local Rust backend in sibling `product-mono`.
It replaces the older root `HANDOFF-LOCAL-BACKEND.md` scratch handoff, which
described the pre-merge `bff-unification` worktree and the removed HS256
`aomi_session` path.

## Start

```bash
pnpm run dev:auth-stack
```

Open:

- Portal: http://localhost:3000
- Backend health: http://127.0.0.1:8080/health

The script starts two tmux sessions:

```bash
tmux attach -t aomi-portal
tmux attach -t aomi-backend
```

Logs:

```bash
tail -f /tmp/aomi-portal.log
tail -f /tmp/aomi-backend.log
```

## What The Script Does

`scripts/dev-auth-stack.sh` owns this local dev stack:

- Uses sibling `../product-mono/run-local-backend.sh` for the Rust backend on
  `127.0.0.1:8080`.
- Runs this repo's `apps/portal` on `127.0.0.1:3000` using
  `apps/portal/node_modules/.bin/next`, which is the portal's Next 16 install.
- Uses the local Supabase Postgres exposed on `127.0.0.1:54322`.
- Ensures `aomi_local` exists.
- Applies product-mono migrations only if the backend `users` table is missing.
- Applies `packages/auth/src/db/schema.sql` for `aomi_users`,
  `aomi_auth_identities`, `aomi_wallets`, and `aomi_account_events`.
- Runs Better Auth's migration helper so `"user"`, `"session"`, `"account"`,
  `"verification"`, and `"walletAddress"` exist.
- Overrides the portal runtime `DATABASE_URL` to
  `postgresql://postgres:postgres@127.0.0.1:54322/aomi_local`.

That last point matters: `apps/portal/.env.local` still has a stale
`DATABASE_URL` for `localhost:55432/aomi_auth`. If you run the portal directly,
Better Auth session reads fail with `ECONNREFUSED`. The script leaves the file
alone and only overrides the env inside the tmux process.

## Commands

```bash
pnpm run dev:auth-stack          # restart backend + portal
pnpm run dev:auth-stack:status   # show health, listeners, tmux sessions
pnpm run dev:auth-stack:stop     # stop the tmux sessions and free ports
./scripts/dev-auth-stack.sh db   # only prepare the local DB/schema
```

## Expected Local Pieces

- OrbStack/Supabase is running and exposes `supabase_db_aomi-api-e2e-supabase`
  on `127.0.0.1:54322`.
- `../product-mono/run-local-backend.sh` exists and points the backend at
  `aomi_local`. A minimal launcher sources `../product-mono/.env.dev`, overrides
  `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/aomi_local`,
  sets `BACKEND_HOST=127.0.0.1` and `BACKEND_PORT=8080`, then runs
  `cargo run -p backend` from `../product-mono/aomi`.
- `../product-mono` keeps any local backend-only development patches needed for
  this stack, especially the patch that makes the backend honor `DATABASE_URL`.
  Do not commit those from this repo.
- `apps/portal/.env.local` has the local backend and auth values, including
  `AOMI_PROXY_BACKEND_URL=http://127.0.0.1:8080` and
  `PORTAL_SERVICE_PRIVATE_KEY`.

## Auth Contract

The live local path is:

```text
browser or CLI -> portal BFF -> Rust backend
```

Browsers authenticate to the portal with the `better-auth.session_token` cookie.
The TypeScript CLI signs in through Better Auth SIWE and sends the opaque
Better Auth bearer session token to the portal. The portal BFF resolves either
session carrier to the canonical Aomi user, mints a short-lived EdDSA
`AccountBearer` with `iss=aomi-bff` and `aud=aomi-backend`, strips browser
cookies and incoming client `Authorization`, then forwards the trusted bearer to
the backend. The backend verifies only; it does not mint this bearer.

The removed local handoff's HS256 `aomi_session`, `/api/auth/token`, and local
BetterAuth JWT/JWKS path are no longer part of this stack.

Unified API/MCP development uses Better Auth 1.7 OAuth Provider JWT/JWKS for
public credentials, but retains the internal Aomi EdDSA trust boundary:

```text
OAuth/session client -> portal -> aud=aomi-api-server -> aud=aomi-backend
```

Set `AOMI_AGENT_API_URL` to the local api-server and use the canonical
`/v1/agent`, `/v1/pipeline`, `/v1/agent/mcp`, and `/v1/pipeline/mcp` resources. The
new surfaces default on outside production. Production-like local runs can
exercise independent rollback with `AOMI_OAUTH_ISSUANCE_ENABLED`,
`AOMI_REST_OAUTH_ENABLED`, `AOMI_AGENT_MCP_OAUTH_ENABLED`,
`AOMI_PIPELINE_MCP_OAUTH_ENABLED`, `AOMI_LEGACY_SESSION_AUTH_ENABLED`,
`AOMI_GUEST_AGENT_REST_ENABLED`, and `AOMI_GUEST_PIPELINE_REST_ENABLED`.
Guest Agent and Pipeline sessions can complete self-custodial work, while
payment submission and delegated custody remain outside the guest scope ceiling.

## Product-Mono Notes

The sibling backend needs the same service public key that matches this repo's
`packages/account/src/topology-data.ts` dev `aomi-bff-dev-1` entry. Keep the
private half only in local environment or a secret manager as
`PORTAL_SERVICE_PRIVATE_KEY`.

If backend startup or chat generation fails, check the sibling backend's local
model/env overrides. The historical handoff noted that only OpenRouter-backed
models were reliable in that local environment, and that `.env.dev` should be
sourced by the shell rather than hand-parsed because values may be quoted.

## Sanity Checks

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/
curl -s http://localhost:3000/v1/account
```

Unauthenticated `/v1/account` should return a null account payload, not a
Better Auth `Failed to get session` error. Some proxied backend routes may return
`401` before login; that is expected.

For a full authenticated CLI smoke, let the script create two temporary SIWE
wallets, sign in with the first, link the second, create/list a thread, create
an app key, send a chat message, then sign in with the second wallet and confirm
it sees the same account/thread:

```bash
AOMI_SMOKE_SIWE=1 node scripts/smoke-auth-stack.mjs
```

You can also smoke an existing browser login by copying the browser's raw Cookie
header for `localhost:3000`:

```bash
AOMI_PORTAL_COOKIE='better-auth.session_token=...' node scripts/smoke-auth-stack.mjs
```

The smoke checks the BFF bearer endpoint, direct backend bearer acceptance,
thread create/list, state, account app discovery, app-key creation, chat, and
the portal proxy thread list. It only prints redacted token claims and app-key
prefixes.
