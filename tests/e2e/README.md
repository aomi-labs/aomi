# Browser tests

## Journeys (fake agent, real Portal auth)

```bash
pnpm run build:packages   # once
AOMI_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/<disposable-db> \
AOMI_TEST_DATABASE_DISPOSABLE=1 \
pnpm run test:journeys --project=portal
```

Playwright starts the fake upstream (port 3462), builds and starts the Portal
(3463) and puts the edge Worker in front of it on the public origin (3460,
`edge-host.ts`: `apps/edge` under `wrangler dev --local`, routed on `/api/*`,
`/v1/*` and `/.well-known/*` exactly as Cloudflare routes a portal host), then
starts the Vite embed example (3461) and runs `journeys/` against them. Drop
`--project` to run the `portal`, `embed-vite` and `mobile` projects. Specs use
the page object in `pom/` and the widget's `testIds`; only `/v1/agent/*` goes
to the in-memory fake in `fake-backend/`, whose request log is attached to
every test. Catalog, account and public discovery reads go through the Worker
to the fake upstream, which accepts bearers from the development keys of both
the edge (`aomi-edge-dev-1`) and the portal BFF (`aomi-bff-dev-1`,
`edge-keys.ts`).

## Production runners (CI)

- `pnpm run test:browser:contracts`: real-auth contracts (sign-in, signing,
  account isolation) on a production Portal behind the edge Worker and the
  packed Vite consumer.
- `pnpm run test:browser:consumers`: the journeys and the ordinary-turn
  performance gate (`performance/`) on the production Portal and packed Vite
  and Next.js consumers, then `scripts/performance/capture-ui.ts`.

Both need `CONSUMER_BASE_SHA` and the two database variables above. Set
`AOMI_PERF_PROFILE=1` to attach a CPU profile to the performance gate.
