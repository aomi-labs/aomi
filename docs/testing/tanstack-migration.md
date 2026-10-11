# Four-app framework migration

Portal, Build, Landing, and Telegram use TanStack Start, Router, Query, Vite, and
Nitro on Node.js. Next.js remains for the protected packed consumer, published
compatibility, and theme utilities.
The migration preserves public HTTP paths, cookie formats, account ownership,
wallet Actions and the Rust/manager/payment/commit service contracts. It adds no
database migration and does not authorize a production deployment.

Portal loads shared Settings and Library UI through
`@aomi-labs/widget/host-composition/overlays` when an overlay opens. The existing
host-composition exports remain supported. Conversation scroll restoration stays
with the widget; Router restores other Portal pages. The cold-load JavaScript
budget, reviewed visual snapshots and immutable consumer assertions are unchanged.
Portal's Vite build resolves the widget's declared entries from workspace source
so package prebundling does not combine these overlays with wallet startup. Its
source imports keep the widget's own alias scope and context instances. Separate
consumer gates continue to install and execute the published tarballs.

Portal and Build's immutable Next baseline is
`9ab669efcfa9572ef6166e71588ae00d089c55d3`. Landing and Telegram's immutable Next
baseline is `0f903a53d81e4201f8f3cefbd828fb3940582dfd`. That second commit is the
historical Portal/Build-only migration checkpoint; evidence recorded against it
does not establish the later Landing or Telegram migration's readiness.
The Landing inventory also preserves the editorial rollout from main at
`6e6a0a225dc384cb24e7d2ff4fc1a2ecbb2a5f49`: `/blog` adds one page to the
24-page baseline, `/news` redirects to it, and the Task API article remains under
`/research`. This supplement does not replace either immutable baseline.

The route parity gate uses the appropriate baseline per host. It reads TypeScript
exports, including destructured handlers and Next metadata endpoints, and
compares public page paths and explicit HTTP methods with Start bindings. Next
private folders contain templates and do not count as public routes:

```sh
node scripts/check-start-route-parity.mjs
node --test tests/contracts/start-route-parity.test.mjs tests/contracts/start-artifact-smoke.test.mjs tests/contracts/start-artifact-environment.test.mjs
```

| Host     | Baseline pages | Baseline HTTP bindings | Authentication and data owner                                                                                                  |
| -------- | -------------: | ---------------------: | ------------------------------------------------------------------------------------------------------------------------------ |
| Portal   |             11 |                     51 | Shared Better Auth/account services; Portal owns its BFF, first-party guest policy and thread URL handoffs                     |
| Build    |             26 |                     54 | Build owns GitHub/CLI sessions, visibility grants and authorization for its control-plane services                             |
| Landing  |             24 |                     15 | Landing owns marketing/MDX, public assets, registry and proxy contracts; wallet examples retain their provider boundaries      |
| Telegram |              1 |                      1 | Telegram owns its Privy v3 provider; the native launch verifier and Portal BFF prove identity and authorize account operations |

Start route files bind native `Request`/`Response` handlers. Protocol endpoints
remain HTTP routes: SDK, widget, CLI, OAuth, MCP, account and deployment clients
do not need Start server-function identifiers. A shared server policy augments
native handler metadata with automatic OPTIONS and method rejection while
preserving explicit HEAD/OPTIONS and the native GET-to-HEAD fallback. Production
artifact probes check these responses without changing the declared-method
inventory. All four server entries also retain the baseline's 308 canonical-path
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

Landing's root is a native GET handler that preserves the committed marketing
HTML and its static assets; it is counted among HTTP bindings. Its examples and
playground pages use Fumadocs MDX through native routes. Markdown, registry,
robots/sitemap, proxy, OpenGraph, and legacy redirect endpoints retain their HTTP
contracts. Server content and asset preparation belong to the host build.

Telegram keeps the Telegram Web App script before hydration. Server HTML shows
the initial wallet ceremony or the existing missing-configuration card, while
Privy v3 and launch/wallet hooks load through a browser-only lazy boundary. Only
server-verified raw `initData` supplies an identity. Its query parser preserves
opaque bot and session identifiers as strings; neither SSR nor local layout
preview supplies an authenticated launch.

## Local and CI checks

Use the selected managed Aomi workspace for installs, builds and full tests.
Generate routes before independent app typechecks; a production bundler build
does not substitute for `tsc`. CI checks affected app route parity before its
existing lint, typecheck, unit-test and production-build steps. Root lockfile and
shared-package changes continue to select the full CI set.

All four deployed apps use Vite 8.3.4 with its native Rolldown production
bundler. Landing pins `fumadocs-mdx` 14.3.2, whose Vite plugin declares peer
support for Vite 6, 7, and 8. Its `fumadocs-mdx/vite` integration prepares `.source`
during postinstall and app typechecking. The root Vitest 3.2 toolchain retains
Vite 7.3.7; app-specific overrides preserve the separate production and test
toolchain identities.

After installing and building shared-package prerequisites, select app checks
through the managed workspace, for example:

```sh
aomi-dev exec --repo frontend <workspace> -- pnpm run typecheck:apps
aomi-dev exec --repo frontend <workspace> -- pnpm run lint:apps
aomi-dev exec --repo frontend <workspace> -- pnpm run test:landing
aomi-dev exec --repo frontend <workspace> -- pnpm run test:telegram
aomi-dev exec --repo frontend <workspace> -- pnpm run build:apps
```

App `build:app` commands build only the host when package prerequisites are
already ready. Run the copied-output and browser gates against the newly built
outputs; earlier Portal/Build results remain historical evidence.

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
`AOMI_ARTIFACT_SECRET_CANARY` used while building the selected apps, and the browser suite's
`AOMI_TEST_DATABASE_URL` with `AOMI_TEST_DATABASE_DISPOSABLE=1` for Portal. Supply
these through the managed workspace's private runtime wrapper. `--app portal`,
`--app build`, `--app landing`, or `--app telegram` selects one output; the
corresponding `--<app>-output` option accepts an alternate artifact path.
`--app <app> --vercel-output <path>` inspects that host's generated Vercel artifact. The runner starts only loopback fixtures and removes
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

Landing probes preserve static HTML/assets against their immutable baseline,
exercise Markdown and registry responses, proxy contracts, redirects, and
OpenGraph rendering with bundled font/background assets. Telegram probes require
the honest wallet shell, method rejection/OPTIONS, canonical redirects, valid
fixture-signed launch verification, and rejected invalid or expired proofs.
These fixtures do not establish hosted Privy sign-in, wallet delegation, or permit
signing; provider/browser verification remains a separate prerequisite.

The public production browser gate runs copied Landing and Telegram Node
artifacts with provider credentials excluded:

```sh
aomi-dev exec --repo frontend <workspace> -- node scripts/test-native-browser.mjs --app landing
aomi-dev exec --repo frontend <workspace> -- node scripts/test-native-browser.mjs --app telegram
```

Landing requires four scenarios: homepage scripts and media, hydrated blog
navigation and browser history, editing a Polymarket MDX control without sending
an operation, and the configurator's interactive preview and generated code.
Telegram requires its hydrated outside-Telegram guard and expandable error
details. Its test hostname is outside the app's localhost-preview bypass. A
temporary local HTTPS proxy provides the transport required by the wallet
provider and browser WebCrypto; only this isolated test context accepts its
self-signed certificate. The signed-launch requirement remains intact. The
Telegram artifact must use the valid-shaped, nonsensitive public Privy fixture
`a123456789012345678901234`. This gate does not prove a signed Telegram launch or
a hosted wallet-provider ceremony.

All five scenarios are mandatory, with no skips or retries. Screenshots, browser
evidence, runtime logs and the checked JSON report are saved under
`output/ci/native-browser/`. The existing 16 auth/visual contracts, 80 packed
consumer scenarios and 55 journeys retain their own unchanged gates.

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
Portal and Build require an authenticated success; Portal also requires an
incremental stream. Landing and Telegram have their own public-content and
launch-verification probes rather than a fabricated account success.
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

The existing Vercel projects may build from the repository root. Its
`vercel-build` entry selects the host using Vercel's system `VERCEL_PROJECT_ID`
and `scripts/vercel-projects.json`, whose public IDs match the backend's
`infra/frontend-surfaces.json`. It publishes that host's native artifact into
the root `.vercel/output`, clearing cached root output before building. Missing
or unregistered project IDs fail the Vercel build. Keep system environment
variables exposed and register a new root project before deploying it; an
app-directory project can instead use that app's own `vercel.json`.

Keep each host's ledgered pre-migration deployment available. A rollback restores
that host's previous deployment/artifact using the existing production rollback
workflow. Verify the affected host's contracts: Portal auth/signed BFF/streamed
turns and durable Actions, Build account/control-plane operations, Landing public
content/proxies/assets, or Telegram launch/auth/wallet ceremony. It does not
reverse a database migration. Move hosts independently; do not replay writes to
both versions. Cross-account
data exposure, failed authorization, repeated wallet/deployment commands or lost
Action recovery require immediate rollback.

Record the tested source, toolchain, package prerequisite/framework build times,
artifact checks, consumer and browser results in the PR. Distinguish failed,
passed and unexercised provider/deployment checks; this document is the verification
procedure, not a claim that a production rollout has happened.
