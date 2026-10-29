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
  - `@aomi-labs/account/policy`: shared session capabilities, OAuth resource
    policies and the one `authorize` check used by Edge and Portal.
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
  - `headers.ts` and `src/kernel/{proxy,cors,csrf}.ts`: forwarding headers,
    open-widget CORS and the cookie CSRF rule.

- `src/build/*`: the Build surface (cutover 1, step 3). On a `BUILD_HOSTS`
  host the edge serves Build's GitHub sign-in (`/api/bff/auth/github/*`), CLI
  login (`/api/bff/cli/*`), builder credits (`/v1/builder/credits/**`), the
  anonymous GitHub App install start and the launch, deployments and operate
  control-plane families (`/api/bff/{launch,deployments,operate}/**`);
  everything else passes through to `BUILD_UPSTREAM_ORIGIN` (the Vercel Build
  app) unchanged: the build sandbox, integrations and local-only helpers.
  - `session.ts`: the `aomi_github`, `aomi_github_visibility` and
    `aomi_github_oauth_request` cookies and the CLI bearer, signed with
    `BUILD_SESSION_SECRET` (HS256, and a JWE for the PKCE exchange code
    derived from it). Build's remaining Vercel routes still read the
    `aomi_github` cookie and CLI bearer with the same value under the name
    `PORTAL_ONLY_SESSION_SECRET`, until those routes move here.
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

The Vercel handlers for the moved proxy families have been deleted. Portal
retains the Better Auth authorization server, session and account management,
widget authentication, connections (`/v1/account/connections/**`) and the
Edge principal attestation endpoint. Its account routes accept session credentials; OAuth access-token
verification for protected resources happens at Edge. Build retains its sandbox
and sidecar authentication; sidecar bearers still use the `aomi-sidecar` audience.

## Running

The example below uses local backend bindings from `.dev.vars`.

```sh
pnpm --filter aomi-edge test        # vitest, no network
pnpm --filter aomi-edge typecheck
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
pnpm --filter aomi-edge dev
```

To test staging origins, run `pnpm --filter aomi-edge dev --env-file
.dev.vars.staging` with an ignored `apps/edge/.dev.vars.staging` holding the staging `BACKEND_ORIGINS`, `API_SERVER_ORIGIN`, `PAYMENT_ORIGIN`,
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

`wrangler.jsonc` is one configuration for every environment: staging, rc and
production deploy the same revision with the same settings. What differs per
environment is inventory and comes from the deploy environment, never from
this repository:

- `EDGE_WORKER_NAME` (`aomi-edge-<env>`), `EDGE_ROUTES` (comma-separated route
  patterns) and `EDGE_TOPOLOGY` (`staging`, `rc` or `production`);
- the origins `BACKEND_ORIGINS`, `API_SERVER_ORIGIN`, `PAYMENT_ORIGIN`,
  `PORTAL_UPSTREAM_ORIGIN`, `BUILD_UPSTREAM_ORIGIN` and `MANAGER_ORIGIN`;
- the hosts and policies `PORTAL_HOSTS`, `BUILD_HOSTS`,
  `CORS_ALLOWED_HOST_PATTERNS`, `TASK_CORS_PUBLIC_ORIGINS`,
  `APP_CATALOG_PLATFORMS` and `APP_DEPLOY_PLATFORMS`.

`scripts/deploy.mjs` passes them to `wrangler deploy` as `--name`, `--route`
and `--var`. product-mono's deploy pipeline reads them from
`infra/cloudflare/edge-environments.json` and its Terraform inventory, so
routing a new host (the production portal at cutover, for example) is a
product-mono change plus a deploy, with no change here.

### Secrets

The Worker has three secrets: `EDGE_SERVICE_PRIVATE_KEY`, `BUILD_SESSION_SECRET`
and `BUILD_GITHUB_TOKEN`. Each one is stored in exactly one place, the
matching product-mono GitHub Environment (`staging`, `rc`, `production`).
product-mono's deploy pushes them to the Worker on every deploy.

- Never run `wrangler secret put` by hand. A value that exists only on the
  Worker is stored nowhere else, so nobody can read it back or rotate it.
- `EDGE_SERVICE_PRIVATE_KEY`: generate it with `pnpm --filter aomi-edge
  generate-key <env>`. Store the private half with `gh secret set
  EDGE_SERVICE_PRIVATE_KEY -e <env> -R aomi-labs/product-mono`. Commit the
  public half in `src/topology-data.ts` and product-mono's
  `service.<env>.toml` in the same change.
- `BUILD_SESSION_SECRET`: the HS256 key of Build's GitHub session cookies. Build's
  Vercel project holds the same value as `PORTAL_ONLY_SESSION_SECRET` until its
  last cookie-reading routes move to the edge. Rotate both together, from the
  GitHub Environment value.
- `BUILD_GITHUB_TOKEN`: read access to platform repositories for the
  release-manifest secret gate. Only the edge reads it.

Everything else is either a per-environment `--var` from the deploy
environment or a constant in code. There are no committed Wrangler vars.

## Portal and Build host prerequisites

An environment's portal routes (`<portal host>/api/*`, `/v1/*`,
`/.well-known/*`) only take effect when that hostname is proxied by Cloudflare
(orange cloud) in the `aomi.dev` zone; a DNS-only CNAME to Vercel bypasses the
Worker. `PORTAL_UPSTREAM_ORIGIN` must be the portal's Vercel alias, never the
public host, or the Worker would call itself. The portal's `AOMI_TRUSTED_ORIGINS`
must include the public host so Better Auth accepts requests whose `Host` is
the Vercel alias.

The same holds for `build-staging.aomi.dev/api/*` and `/v1/*` with
`BUILD_UPSTREAM_ORIGIN`. The GitHub OAuth apps' callback URL stays
`https://<build host>/api/bff/auth/github/callback`, which the edge now answers.
Build signs in with the staging or production GitHub App for its topology. Their
public OAuth client ids are committed in `src/build/github-auth.ts`. The client
secrets stay in Manager's second `[[apps]]` entry (app index 2).
