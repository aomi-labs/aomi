# Portal and Build framework migration

Portal and Build use TanStack Start, Router, Query and Nitro on Node.js. Landing,
Telegram and the existing packed Next.js consumer keep their Next.js hosts.
The migration preserves public HTTP paths, cookie formats, account ownership,
wallet Actions and the Rust/manager/payment/commit service contracts. It adds no
database migration and does not authorize a production deployment.

The immutable Next baseline is
`9ab669efcfa9572ef6166e71588ae00d089c55d3`. The route parity gate reads its
TypeScript exports, including destructured handlers, and compares public page
paths and explicit HTTP methods with the candidate's Start bindings:

```sh
node scripts/check-start-route-parity.mjs
node --test tests/contracts/start-route-parity.test.mjs tests/contracts/start-artifact-smoke.test.mjs tests/contracts/start-artifact-environment.test.mjs
```

| Host   | Baseline pages | Baseline HTTP bindings | Authentication and data owner                                                                              |
| ------ | -------------: | ---------------------: | ---------------------------------------------------------------------------------------------------------- |
| Portal |             11 |                     51 | Shared Better Auth/account services; Portal owns its BFF, first-party guest policy and thread URL handoffs |
| Build  |             26 |                     54 | Build owns GitHub/CLI sessions, visibility grants and authorization for its control-plane services         |

Start route files bind native `Request`/`Response` handlers. Protocol endpoints
remain HTTP routes: SDK, widget, CLI, OAuth, MCP, account and deployment clients
do not need Start server-function identifiers. A shared server policy augments
native handler metadata with automatic OPTIONS and method rejection while
preserving explicit HEAD/OPTIONS and the native GET-to-HEAD fallback. Production
artifact probes check these responses without changing the declared-method
inventory. Both server entries also retain the baseline's 308 canonical-path
redirects before page, native HTTP, proxy or legacy redirect dispatch. Root URLs
stay unchanged; encoded query strings and non-GET methods survive the redirect.
The copied artifacts exercise those cases. The static parity gate does not
prove authorization, implicit HEAD/OPTIONS behavior, redirects, CORS, cookie
attributes or streaming. Exercise those against production builds, including
empty and nested optional catchall paths and encoded route parameters.

| Resource                                        | Lifetime and cache policy                                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host QueryClient                                | One per SSR request; stable for a browser router; only successful queries explicitly marked `meta.ssrSafe` may dehydrate; mutations never dehydrate |
| Widget display and wallet state                 | Existing widget/React providers retain their own lifetime, persistence and Action ownership                                                         |
| Build projects, SDK status and deployment feeds | Existing query keys, freshness, retries, polling and invalidation remain in their owning features                                                   |
| Build server read caches and Postgres pools     | Process-owned services retain their existing limits; authentication and resource authorization still precede access                                 |

## Local and CI checks

Use the selected managed Aomi workspace for installs, builds and full tests.
Generate routes before independent app typechecks; a production bundler build
does not substitute for `tsc`. CI checks affected app route parity before its
existing lint, typecheck, unit-test and production-build steps. Root lockfile and
shared-package changes continue to select the full CI set.

Portal and Build use Vite 8.3.4 with its native Rolldown production bundler.
The root Vitest 3.2 toolchain retains Vite 7.3.7; app-specific overrides preserve
that distinction without changing the remaining app toolchains.

Build's inherited Node compatibility hooks require native TypeScript support.
Use an official Node 22 runtime (22.15 or newer) or Node 24. Some distribution
builds omit that support despite meeting the version requirement; use the
bundled official Node 24 runtime locally when the system binary lacks it.

The production browser harness starts Portal from
`apps/portal/.output/server/index.mjs` with `HOST` and `PORT`. It retains the
disposable-database confirmation, fake upstream JWT verification, trusted-base
packed Vite and Next consumers, every mandatory browser case and the failure,
skip, flake and minimum-case gates. The performance capture reads `/assets/`
JavaScript from `.output/public`; its existing first-load budget is unchanged.

Run the existing `test:contracts`, `test:browser:contracts`,
`test:browser:consumers` and journey commands with their documented prerequisites
and the actual trusted consumer base. Injected-wallet cases use throwaway keys
and do not broadcast transactions. A hosted-provider smoke is separate evidence.

## Clean Node artifact smoke

Build each app's Node preset, then run its output without workspace dependencies:

```sh
aomi-dev exec --repo frontend tanstack-migration -- node scripts/test-start-artifacts.mjs
```

The fixture runner requires installed workspace test dependencies, the same
`AOMI_ARTIFACT_SECRET_CANARY` used while building both apps, and the browser suite's
`AOMI_TEST_DATABASE_URL` with `AOMI_TEST_DATABASE_DISPOSABLE=1` for Portal. Supply
these through the managed workspace's private runtime wrapper. `--app portal` or
`--app build` selects one output; `--portal-output` and `--build-output` accept
alternate artifact paths. The runner starts only loopback fixtures and removes
its owned temporary artifacts and fixture records afterward.

Portal uses the existing browser fixture database, migrates its existing auth
schema, and seeds one disposable canonical account and opaque widget session.
It checks an authenticated `/v1/account` read and a signed BFF assertion against
the fake upstream, then observes two SSE chunks separated by 1.5 seconds. Build
uses a throwaway signed GitHub cookie and performs a native authenticated read.
Its controlled `builder: "none"` operation initializes the real local Smither
workflow against an empty non-Git SDK checkout and requires the durable first
`binaries` stage to fail with the SDK freshness prerequisite. This exercises the
copied external dependencies, Node Bun compatibility hooks and workflow store;
it does not claim that generation, Cargo compilation or deployment succeeded.
Provider, deployment and live database credentials are excluded from the child
runtime. The fixture stops before those operations.

For an independently configured runtime, the lower-level probe accepts a JSON
list of real endpoint checks:

```sh
aomi-dev exec --repo frontend tanstack-migration -- node scripts/smoke-start-artifact.mjs --app portal --artifact apps/portal/.output --checks /tmp/portal-artifact-probes.json
aomi-dev exec --repo frontend tanstack-migration -- node scripts/smoke-start-artifact.mjs --app build --artifact apps/build/.output --checks /tmp/build-artifact-probes.json
```

The caller supplies the configured runtime environment and a controlled upstream.
Set `AOMI_ARTIFACT_SECRET_CANARY` to the same throwaway private value for the
production build and artifact probe. The probe scans public JavaScript, source
maps, HTML, JSON and CSS; a leak fails before startup. With no canary configured,
the script explicitly reports that this check was not run.
Probe credentials are environment-variable values; keep real tokens out of JSON
and command arguments. The JSON array adds authenticated reads or controlled
operations to the script's anonymous/auth-rejection/readiness probes. For example:

```json
[
  {
    "path": "/v1/account",
    "status": 200,
    "headersFromEnv": { "authorization": "ARTIFACT_ACCOUNT_AUTHORIZATION" },
    "json": { "user.id": "expected-throwaway-account" }
  },
  {
    "path": "/controlled-stream-path",
    "method": "POST",
    "status": 200,
    "headersFromEnv": { "authorization": "ARTIFACT_ACCOUNT_AUTHORIZATION" },
    "body": { "controlled": true },
    "headers": { "content-type": "text/event-stream" },
    "stream": { "minChunks": 2, "maxFirstChunkMs": 800, "minDurationMs": 1200 }
  }
]
```

Replace example paths and JSON fields with the real endpoint contract and fixture
identity. `requestHeaders` can supply required Origin/protocol headers;
`headersFromEnv` supplies Cookie or Authorization. Body objects are JSON encoded.
Streaming requires multiple chunks, with the first arriving before the controlled
stream can complete; a buffered body cannot pass. The script copies only the
artifact into a temporary directory, rejects external symlinks and secret files,
clears Node workspace-resolution overrides and stops only its own process.
Both hosts require an authenticated success; Portal also requires an incremental
stream.
Build also needs a controlled operation that loads Smither after its Node Bun
compatibility hooks; startup alone does not establish that engine's readiness.

The baseline already embeds committed topology TOML content in the account
package's `topology-data.ts`, and its test constructs the signing service without
app-root TOML files. A successful signed BFF read from the copied artifact proves
this path. Preserve external Smither dependencies and their runtime assets.

## Hosting and rollback

App Vercel configuration clears the former Next framework/output overrides;
the app's Nitro Vercel preset emits the Build Output API artifact. Keep the
existing origin, backend endpoints, signing keys, cookie settings and release
metadata. Public environment names remain compatible, with an explicit browser
allowlist. Never define the entire server environment in the browser bundle.
Verify the generated Vercel function assets and streaming before promotion;
Node artifact success alone does not prove a hosted Vercel deployment.

Keep the ledgered pre-migration Portal and Build deployments available. A rollback
restores each host's previous deployment/artifact using the existing production
rollback workflow, then verifies auth, signed BFF access, streamed turns and
durable Action recovery. It does not reverse a database migration. Move Portal
and Build independently; do not replay writes to both versions. Cross-account
data exposure, failed authorization, repeated wallet/deployment commands or lost
Action recovery require immediate rollback.

Record the tested source, toolchain, package prerequisite/framework build times,
artifact checks, consumer and browser results in the PR. Distinguish failed,
passed and unexercised provider/deployment checks; this document is the verification
procedure, not a claim that a production rollout has happened.
