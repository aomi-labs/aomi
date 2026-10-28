# aomi-edge

The Cloudflare Worker that is the public edge for every Aomi HTTP surface. It
replaces `product-mono/infra/cloudflare/worker` and owns the proxy half of
the Portal and Build BFFs.

One rule for every route: **the Worker owns the outside shape, the Rust
services own the inside shape.** Whatever a browser, CLI, MCP client or x402
venue sends, the Worker turns it into one typed call with a bearer it minted
as topology node `aomi-edge`. Rust never sees a venue header, a cookie or a
venue-specific URL.

## Route ownership after cutover 1

- `src/api/*` and `src/kernel/*`: the routing core ported from product-mono: route allowlist,
  CORS profiles, rendezvous hashing over `BACKEND_ORIGINS`, tunnel failover,
  the hosted-app availability probe and the manager cutover switch.
- `src/api/task-body.ts` and `src/api/discovery.ts`: the Task API venue adapters.
  - A venue's `Authorization`, cookies and router headers never reach the API
    Server (`TASK_UPSTREAM_HEADERS`).
  - `GET`, `HEAD` and an empty `POST` on `/v1/task/build` answer the API
    Server's own body-bound 402 for its example request, cached within its
    validity window (`EDGE_CACHE` KV, in-isolate fallback).
  - A `text/plain` body that is JSON is relabelled `application/json`; the
    bytes are untouched so a `Payment-Signature` retry stays bound to them.
- `src/identity.ts`: the edge as an `AomiService` over
  `@aomi-labs/service-identity`; every bearer the proxies send is minted here.
- `src/portal/*`: the portal surface. On a `PORTAL_HOSTS` host the edge is
  the portal's only server; page paths pass through to `PORTAL_UPSTREAM_ORIGIN`
  (the portal app) unchanged, cookies included.
  - `principal.ts`: who is calling, from exactly one credential. OAuth access
    tokens (Bearer or DPoP) are verified against Better Auth's JWKS (isolate
    and `EDGE_CACHE`). A session cookie, Better Auth bearer or widget session
    token is read from the database in-process (`src/auth/server.ts`).
  - `@aomi-labs/account/policy`: shared session capabilities, OAuth resource
    policies and the one `authorize` check.
  - `routes.ts`: the route table. `/v1/agent/**`, `/v1/pipeline/**`,
    `/v1/account/{apps,transaction-safety,credits,statement}`, the account's
    wallets, agent wallets, lanes and platform links (`/v1/account/{wallets,
    agent-wallets,pause-all,connection-settings,connections/:key/wallets,
    link}`), thread-less commits (`/v1/commits/:ref/**`), the agent, pipeline
    and app-locked (`/v1/apps/:app/mcp`) MCP transports, the `/api/*` backend
    allowlist, discovery and the public catalog. Bearers are minted as
    `aomi-edge` with the same delegated claims the portal minted as
    `aomi-bff`; a backend bearer carries no scope, only how the caller signed
    in (`auth_source`: `session`, `cli_session`, `widget`, `oauth`), its
    class and its OAuth client, which decide portal-only writes, approvals
    and a thread's origin.
  - `headers.ts` and `src/kernel/{proxy,cors}.ts`: forwarding headers and
    open-widget CORS; the cookie CSRF rule is `@aomi-labs/account/csrf`.
- `src/auth/*`: the account surface on a portal host. Better Auth
  (`@aomi-labs/account/better-auth`, built once per isolate) and its OAuth
  server, device login and consent under `/api/auth/**`, widget sign-in
  (`/api/auth/widget/**`), the account graph (`/v1/account`, identities,
  wallets, connections, merge, provider links, CLI session), device auth
  (`/v1/account/device-auth/**`), the OAuth discovery documents and
  `/openapi.json`. Every request that needs the database gets its own pg
  pool over the `HYPERDRIVE` binding (`withDatabase`), closed when it ends.
- `src/landing.ts`: the Landing surface. On a `LANDING_HOSTS` host the edge
  forwards the API consoles' public thread routes to the backend anonymously
  and passes every other path to `LANDING_UPSTREAM_ORIGIN`.
- `src/dev.ts`: the local development entry (`wrangler dev --env dev`), the
  Worker plus the E2E wallet harness (`/api/bff/e2e/*`). Never deployed.

- `src/build/*`: the Build surface (cutover 1, step 3). On a `BUILD_HOSTS`
  host the edge serves Build's GitHub sign-in (`/api/bff/auth/github/*`), CLI
  login (`/api/bff/cli/*`), builder credits (`/v1/builder/credits/**`), the
  anonymous GitHub App install start and the launch, deployments and operate
  control-plane families (`/api/bff/{launch,deployments,operate}/**`);
  everything else passes through to `BUILD_UPSTREAM_ORIGIN` (the Vercel Build
  app) unchanged: the build sandbox, integrations and local-only helpers.
  - `session.ts`: the `aomi_github`, `aomi_github_visibility` and
    `aomi_github_oauth_request` cookies and the CLI bearer, signed with
    `BUILD_SESSION_SECRET` (HS256, and a JWE for the PKCE exchange code).
    Same cookie names, audiences, claims and lifetimes as the Build BFF, so
    cookies issued by either side verify on the other during the cutover.
  - `manager-client.ts`: the GitHub code exchange and project claim, called
    as the `aomi-edge` service. `src/kernel/manager.ts` is the single resolver
    for Manager destinations across the API and Build surfaces.
  - `deploy.ts`, `operate.ts`: the launch, deployments and operate routes,
    each one `endpoint()` (auth, a zod input, a handler) with the ownership
    checks of the Build BFF. The manager is called through
    `@aomi-labs/internal` (`ManagerClient`) with a five-minute `aomi-edge`
    service bearer; failures answer with the same
    `{ error, code?, retryable?, deployError? }` bodies.
  - Not moved: `build/**` (the Vercel sandbox), `integrations`, `dev-session`
    (local only) and `internal/sentry-smoke`.

The portal has no server code: every portal API path is served here. Build
retains its sandbox and sidecar authentication; sidecar bearers still use the
`aomi-sidecar` audience.

## Running

The example below uses local backend bindings. `dev:staging` selects the
Wrangler environment; the copied variables still point at localhost.

```sh
pnpm --filter aomi-edge test        # vitest, no network
pnpm --filter aomi-edge typecheck
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://postgres:postgres@127.0.0.1:54322/<db> \
  pnpm --filter aomi-edge dev
```

To test staging origins, use an ignored `apps/edge/.dev.vars.staging` with
the staging `BACKEND_ORIGINS`, `API_SERVER_ORIGIN`, `PAYMENT_ORIGIN`,
`EDGE_TOPOLOGY=staging` and the matching staging service private key. Obtain
origins from the staging inventory and credentials from its secret store.

Each hosted-app availability probe has a 1.5-second deadline. A timed-out
origin is unavailable for that attempt, so healthy pool members can serve
the request; configured warm-up retries retain their existing limit.

Discovery-cache follow-up: coalesce concurrent misses per origin within an
isolate, test that a burst creates one quote and that failure releases the
pending entry. Cache hits already reuse quotes, but concurrent misses and
different isolates can currently create extra quote rows. This is an
efficiency follow-up, not a payment execution path.

## Deploying

`scripts/deploy.mjs <staging|production>` runs `wrangler deploy` with
`BACKEND_ORIGINS`, `API_SERVER_ORIGIN`, `PAYMENT_ORIGIN`,
`PORTAL_UPSTREAM_ORIGIN` and `BUILD_UPSTREAM_ORIGIN` taken from the deploy environment. product-mono's deploy pipeline derives those from its
Terraform inventory and exports them before calling this script. Secrets:
`EDGE_SERVICE_PRIVATE_KEY` (`pnpm --filter aomi-edge generate-key`) and
`BUILD_SESSION_SECRET` (Build's `PORTAL_ONLY_SESSION_SECRET`, so existing
GitHub sessions survive the cutover), `BUILD_GITHUB_TOKEN` (Build's
`GITHUB_TOKEN`, read access for the release-manifest secret gate),
`BETTER_AUTH_SECRET` (the portal's, so sessions and the encrypted JWKS keys
survive the move) and the Privy and Para keys the portal reads today. The
`HYPERDRIVE` binding needs a Hyperdrive config per environment, created with
caching disabled.

## Portal and Build host prerequisites

The portal routes in `wrangler.jsonc` (`chat-staging.aomi.dev/api/*`, `/v1/*`,
`/.well-known/*`) only take effect when that hostname is proxied by Cloudflare
(orange cloud) in the `aomi.dev` zone; a DNS-only CNAME to Vercel bypasses the
Worker. `PORTAL_UPSTREAM_ORIGIN` must be the portal's Vercel alias, never the
public host, or the Worker would call itself.

The same holds for `build-staging.aomi.dev/api/*` and `/v1/*` with
`BUILD_UPSTREAM_ORIGIN`. The GitHub OAuth apps' callback URL stays
`https://<build host>/api/bff/auth/github/callback`, which the edge now answers.
For a deployment with its own GitHub App, set the Worker var
`BUILD_GITHUB_CLIENT_ID` to that App's OAuth client id and configure the matching
credentials in Manager's second `[[apps]]` entry (app index 2). The client secret
stays in Manager. Without this override, Build uses the staging or production App
for its topology.
