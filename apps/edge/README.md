# aomi-edge

The Cloudflare Worker that is the public edge for every Aomi HTTP surface. It
replaces `product-mono/infra/cloudflare/worker` and, over the two cutovers in
the design doc, absorbs the proxy half of the Portal and Build BFFs.

One rule for every route: **the Worker owns the outside shape, the Rust
services own the inside shape.** Whatever a browser, CLI, MCP client or x402
venue sends, the Worker turns it into one typed call with a bearer it minted
as topology node `aomi-edge`. Rust never sees a venue header, a cookie or a
venue-specific URL.

## What is here now (cutover 1, step 1)

- `src/routing/*`: the routing core ported from product-mono: route allowlist,
  CORS profiles, rendezvous hashing over `BACKEND_ORIGINS`, tunnel failover,
  the hosted-app availability probe and the manager cutover switch.
- `src/task/*`: the Task API venue adapters.
  - A venue's `Authorization`, cookies and router headers never reach the API
    Server (`TASK_UPSTREAM_HEADERS`).
  - `GET`, `HEAD` and an empty `POST` on `/v1/task/build` answer the API
    Server's own body-bound 402 for its example request, fetched once per
    validity window and cached (`EDGE_CACHE` KV, in-isolate fallback).
  - A `text/plain` body that is JSON is relabelled `application/json`; the
    bytes are untouched so a `Payment-Signature` retry stays bound to them.
- `src/identity.ts`: the edge as an `AomiService` over
  `@aomi-labs/service-identity`; every bearer the proxies send is minted here.
- `src/portal/*`: the portal surface (cutover 1, step 2). On a `PORTAL_HOSTS`
  host the edge is the portal's BFF for every route family the design marks
  "moves"; everything else passes through to `PORTAL_UPSTREAM_ORIGIN` (the
  Vercel portal) unchanged, cookies included.
  - `principal.ts`: who is calling, from exactly one credential. OAuth access
    tokens (Bearer or DPoP) are verified at the edge against the portal's
    Better Auth JWKS. A session cookie, Better Auth bearer or widget session
    token is a database question, so the edge asks the portal once:
    `POST /api/auth/edge/principal` answers with a five-minute JWT signed by
    the same JWKS key that says who the credential belongs to. The edge
    verifies and caches it until it expires (`EDGE_CACHE`), so revocation
    lands at the next refresh.
  - `policy.ts`: capabilities per session kind, OAuth resource policies and the
    one `authorize` check, ported unchanged from the portal.
  - `routes.ts`: the route table. `/v1/agent/**`, `/v1/pipeline/**`,
    `/v1/account/{apps,transaction-safety,credits,statement}`, the two MCP
    transports, the `/api/*` backend allowlist, delegation begin, discovery
    and the public catalog. Bearers are minted as `aomi-edge` with the same
    delegated claims the portal minted as `aomi-bff`.
  - `forward.ts`, `cors.ts`, `csrf.ts`: the header policies, open-widget CORS
    and the cookie CSRF rule, copied from `@aomi-labs/account`.

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
  - `manager.ts`: the GitHub code exchange and project claim, called as the
    `aomi-edge` service.
  - `deploy.ts`, `operate.ts`: the launch, deployments and operate routes,
    each one `endpoint()` (auth, a zod input, a handler) with the ownership
    checks of the Build BFF. The manager is called through
    `@aomi-labs/internal` (`ManagerClient`) with a five-minute `aomi-edge`
    service bearer; failures answer with the same
    `{ error, code?, retryable?, deployError? }` bodies.
  - Not moved: `build/**` (the Vercel sandbox), `integrations`, `dev-session`
    (local only) and `internal/sentry-smoke`.

The Vercel route files for the moved families stay until cutover day and are
deleted in one PR; until then both serve the same requests the same way.

## Running

```sh
pnpm --filter aomi-edge test        # vitest, no network
pnpm --filter aomi-edge typecheck
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
pnpm --filter aomi-edge dev:staging
```

## Deploying

`scripts/deploy.mjs <staging|production>` runs `wrangler deploy` with
`BACKEND_ORIGINS`, `API_SERVER_ORIGIN`, `PAYMENT_ORIGIN`,
`PORTAL_UPSTREAM_ORIGIN` and `BUILD_UPSTREAM_ORIGIN` taken from the deploy environment. product-mono's deploy pipeline derives those from its
Terraform inventory and exports them before calling this script. Secrets:
`EDGE_SERVICE_PRIVATE_KEY` (`pnpm --filter aomi-edge generate-key`) and
`BUILD_SESSION_SECRET` (Build's `PORTAL_ONLY_SESSION_SECRET`, so existing
GitHub sessions survive the cutover) and `BUILD_GITHUB_TOKEN` (Build's
`GITHUB_TOKEN`, read access for the release-manifest secret gate).

## Portal and Build host prerequisites

The portal routes in `wrangler.jsonc` (`chat-staging.aomi.dev/api/*`, `/v1/*`,
`/.well-known/*`) only take effect when that hostname is proxied by Cloudflare
(orange cloud) in the `aomi.dev` zone; a DNS-only CNAME to Vercel bypasses the
Worker. `PORTAL_UPSTREAM_ORIGIN` must be the portal's Vercel alias, never the
public host, or the Worker would call itself. The portal's `AOMI_TRUSTED_ORIGINS`
must include the public host so Better Auth accepts requests whose `Host` is
the Vercel alias.

The same holds for `build-staging.aomi.dev/api/*` and `/v1/*` with
`BUILD_UPSTREAM_ORIGIN`. The GitHub OAuth apps' callback URL stays
`https://<build host>/api/bff/auth/github/callback`, which the edge now answers.
For a deployment with its own GitHub App, set the Worker var
`BUILD_GITHUB_CLIENT_ID` to that App's OAuth client id and configure the matching
credentials in Manager's second `[[apps]]` entry (app index 2). The client secret
stays in Manager. Without this override, Build uses the staging or production App
for its topology.
