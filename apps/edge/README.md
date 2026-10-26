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
    Server's own body-bound 402 for its example request, cached within its
    validity window (`EDGE_CACHE` KV, in-isolate fallback).
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

The Vercel route files for the moved families stay until cutover day and are
deleted in one PR; until then both serve the same requests the same way.

## Running

The example below uses local backend bindings. `dev:staging` selects the
Wrangler environment; the copied variables still point at localhost.

```sh
pnpm --filter aomi-edge test        # vitest, no network
pnpm --filter aomi-edge typecheck
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
pnpm --filter aomi-edge dev:staging
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
`BACKEND_ORIGINS`, `API_SERVER_ORIGIN`, `PAYMENT_ORIGIN` and
`PORTAL_UPSTREAM_ORIGIN` taken from the deploy environment. product-mono's deploy pipeline derives those from its
Terraform inventory and exports them before calling this script. Secrets:
`EDGE_SERVICE_PRIVATE_KEY` (`pnpm --filter aomi-edge generate-key`).

## Portal host prerequisites

The portal routes in `wrangler.jsonc` (`chat-staging.aomi.dev` and
`chat.aomi.dev`: `/api/*`, `/v1/*`, `/.well-known/*`) only take effect when
that hostname is proxied by Cloudflare (orange cloud) in the `aomi.dev` zone; a
DNS-only CNAME to Vercel bypasses the Worker. The production Worker is deployed
by hand (product-mono's `deploy-cloudflare-manual` workflow) and only after the
production backend trusts the `aomi-edge` issuer; deploying it earlier routes
production logins to a Worker the backend rejects. `PORTAL_UPSTREAM_ORIGIN` must be the portal's Vercel alias, never the
public host, or the Worker would call itself. The portal's `AOMI_TRUSTED_ORIGINS`
must include the public host so Better Auth accepts requests whose `Host` is
the Vercel alias.
