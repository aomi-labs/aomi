# Browser tests

## Journeys (fake agent, real Portal auth)

```bash
pnpm run build:packages   # once
AOMI_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/<disposable-db> \
AOMI_TEST_DATABASE_DISPOSABLE=1 \
pnpm run test:journeys --project=portal
```

Playwright builds and starts the Portal (port 3460), the fake upstream (3462)
and the Vite embed example (3461), then runs `journeys/` against them. Drop
`--project` to run the `portal`, `embed-vite` and `mobile` projects. Specs use
the page object in `pom/` and the widget's `testIds`; only `/v1/agent/*` goes
to the in-memory fake in `fake-backend/`, whose request log is attached to
every test.

## Production runners (CI)

- `pnpm run test:browser:contracts`: real-auth contracts (sign-in, signing,
  account isolation) on a production Portal and the packed Vite consumer.
- `pnpm run test:browser:consumers`: the journeys and the ordinary-turn
  performance gate (`performance/`) on the production Portal and packed Vite
  and Next.js consumers, then `scripts/performance/capture-ui.ts`.

Both need `CONSUMER_BASE_SHA` and the two database variables above. Set
`AOMI_PERF_PROFILE=1` to attach a CPU profile to the performance gate.
