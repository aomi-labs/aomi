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
  `@aomi-labs/service-identity`, used by the proxies that follow.

## Running

```sh
pnpm --filter aomi-edge test        # vitest, no network
pnpm --filter aomi-edge typecheck
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
pnpm --filter aomi-edge dev:staging
```

## Deploying

`scripts/deploy.mjs <staging|production>` runs `wrangler deploy` with
`BACKEND_ORIGINS`, `API_SERVER_ORIGIN` and `PAYMENT_ORIGIN` taken from the
deploy environment. product-mono's deploy pipeline derives those from its
Terraform inventory and exports them before calling this script. Secrets:
`EDGE_SERVICE_PRIVATE_KEY` (`pnpm --filter aomi-edge generate-key`).
