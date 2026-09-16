# Current State

## Last Updated

2026-09-03 — MCP GRANTS NEVER CARRIED A REFRESH TOKEN (branch
  `fix/mcp-offline-access-advertised`). Agent MCP and Pipeline MCP sessions
  went invalid a few minutes after login. The refresh machinery was fine —
  proven end to end in `apps/portal/src/app/api/auth/oauth-mcp-refresh.postgres.test.ts`,
  which drives DCR → authorize → consent → token → refresh against a real
  Postgres and gets a correctly-audienced JWT back. What was wrong is what
  the resource ADVERTISES. `/.well-known/oauth-protected-resource/v1/{agent,pipeline}/mcp`
  published `policy.allowedScopes`, and the `WWW-Authenticate` challenge
  published `challengeScopes`; neither named `offline_access`. An MCP client
  builds its authorization request out of exactly that set, so it never asked
  for `offline_access`, Better Auth issued no refresh token
  (`isRefreshToken` requires the scope on the request or the prior grant), and
  the grant died at the 5-minute `accessTokenTtl` with nothing to refresh.
  Every other layer already allowed it — the seeded `ba_oauth_resources` row,
  `narrowScopesForAomiResource`, `validateAomiResourceScopes` and the SDK
  (`sdk/auth.ts` appends `offline_access` to every token request, which is why
  the CLI/device path never showed this). The three open-coded
  `[...allowedScopes, "offline_access"]` spellings are now one derived
  `AomiOAuthResourcePolicy.grantableScopes`: `allowedScopes` stays the ceiling
  on what a principal may DO (`downscopeMcpPrincipal` still strips
  `offline_access`), `grantableScopes` is what a grant may CARRY and is what
  gets advertised, seeded, and narrowed to.
  NOT fixed here, and worth a decision: `refreshTokenReuseInterval: 0` in
  `packages/account/src/better-auth/auth.ts` means two in-flight refreshes with
  the same token leave one caller with `invalid_grant`, and a client that
  RETRIES that call presents an already-rotated token, which trips
  `invalidateRefreshFamily` and destroys every grant for that client+user. With
  a 5-minute access token and a parallel MCP client that race is reachable; a
  short reuse interval (RFC 9700's rotation grace) would absorb it.

2026-09-03 — CLI DEVICE-AUTH HANDOFF vs PARA JWT BACKOFF (branch
  `codex/auth-provider-device`, PR #561). Live Para login on
  `/device-auth` succeeded in the browser but the CLI never got its loopback
  callback: `createParaCredentialGetter` arms a 30 s cooldown on the first
  `issueJwt` 401/403 after login and returns `null` silently, while the page's
  credential wait was also 30 s, so the page always expired just before the
  getter's first permitted retry. Fixes: `getAccountCredential({ fresh: true })`
  (new `AomiAccountCredentialOptions`) bypasses the Para backoff for one-shot
  handoffs while polling widgets keep it; a shared
  `apps/portal/src/lib/device-auth-handoff.ts` waits up to 90 s at 1.5 s
  intervals and throws `DeviceAuthHandoffError` with stable codes
  (`provider_credential_timeout`, `provider_account_conflict` for HTTP 409,
  `provider_exchange_rate_limited`, `device_grant_failed`, ...) that
  `classifyProviderInitializationFailure` passes through instead of the
  catch-all `para_initialization_failed`; the page tracks attempts so a
  getter identity change cannot start a second exchange, and shows Cancel
  while waiting because Para's `login()` resolves when its modal opens and a
  dismissed modal had no signal. `/oauth/device` now reads the wallet kit
  through a ref (its click-time closure could never see the getter that
  appears after Para authenticates) and uses the same waiter with a 180 s
  budget. Known, not fixed here: the provider exchange endpoint still reuses
  the Better Auth user by email, so a second provider with the same email as
  an existing account gets 409 (now surfaced as `provider_account_conflict`);
  and the CLI still receives the browser's own Better Auth session token from
  the grant, so logout on either side ends both.

2026-08-26 — AUTH STACK CLEAN-SLATE CUTOVER (branch
  `codex/unified-auth-provider`, committed and pushed; pairs with
  product-mono `codex/unified-auth-schema`). The Better Auth 1.7 stack now
  cuts over instead of running parallel stores: token/consent models map to
  canonical `ba_oauth_access_tokens`/`ba_oauth_consents` (the `_17_` tables
  and the legacy-window design are gone), the dead `oauthApplication` mapping
  is removed (no such model in the 1.7 mcp plugin), SIWS writes
  `createLocalAccountIssuer(SIWS_PROVIDER_ID)` matching core's
  `local:<provider_id>` issuer convention (which the schema migration also
  backfills), and portal client lookups read `ba_oauth_clients.redirect_uris`
  (jsonb) instead of the dropped `ba_oauth_applications`. At cutover MCP
  clients re-register via DCR/CIMD and users re-consent once; sessions and
  canonical identity are untouched. Downstream `codex/unified-auth-*` and
  release branches carry the merge.

2026-08-26 — Two Privy bugs reported from #builders (Waves): the automatic-
signing toggle always answered "Open a chat thread before enabling automatic
signing." with a chat open, and a swap's approve never popped a Privy prompt.

Bug 1 was structural. SettingsModal/PackagesModal were siblings of
`AomiFrame.Root`, which is what mounts `AomiRuntimeApiProvider`, so
`useOptionalAomiRuntime()` in `use-account-acl.ts` was ALWAYS null and the
thread guard could never pass from settings. They now render inside
`AomiFrame.Root` and reach `<body>` through the new
`apps/portal/src/components/shell/overlay-portal.tsx`, which keeps the React
context and moves only the DOM so one backdrop still covers sidebar + chat.
The portal container needs its own `zIndex: 60`: `position: fixed` makes it a
stacking context, so the modals' own z-60 counts only inside it and the
sidebar's z-10 painted over the left edge (caught in the browser, fixed,
re-verified). Deliberately NOT fixed by feeding it the synthetic settings
session id from `settings-api.ts` — that would bind the delegation grant to an
unrelated "settings thread". The portal-aomi-frame test mock now renders Root's
children (it did not before, which is what hid this) and asserts the nesting.

Bug 2: the portal runs Privy through the plugin lane (`privyPlugin.wrap` ->
plain `PrivyProvider`, no `@privy-io/wagmi`), so the embedded EOA is a
synthetic session, not a wagmi connector. `PrivyPluginProvider` gave it
`signMessage`/`signTypedData` but no send path — `sendTransaction` existed only
when a client smart wallet did — so sends fell through to a wagmi connector
that was never connected, threw, and `RuntimeTxHandler` rejected them into the
console. New `privy-embedded-execution.ts` sends via
`switchChain` + fresh `getEthereumProvider()` + `eth_sendTransaction`, wired in
as `sendTransactionAsync`/`switchChainAsync` overrides so the shared executor
keeps owning batching, nonce ordering and partial-batch reporting.
Signer choice is now one decision (`embeddedSigner` / `smartWalletSigner`):
external wagmi wallet wins, then the embedded EOA — which is the identity the
backend quotes against — and the client smart account only when there is no
embedded EOA, so a swap priced for the EOA can no longer be sent from the smart
account. `RuntimeTxHandler` now also surfaces failures as an error
notification instead of console-only.
UNVERIFIED end to end: no Privy credentials or backend in this worktree, so the
delegation call and a real embedded-EOA broadcast were not exercised. Covered
by unit tests (`privy-embedded-execution.test.ts`, incl. one through
`buildEvmExecutionRuntime`) and the overlay was browser-verified against the
portal dev server.

2026-08-25 — Payment rails split out of /pricing (Cecilia). The x402 deferred
credit gate explainer from aomi-design
`communication/info/x402-deferred-credit-gate.html` now lives at
/pricing/payment-rails rather than going onto /pricing, because the pricing
page was deliberately built as audience-first and not a technical explainer
(her instruction, 2026-08-24). New files under (marketing)/pricing/payment-rails:
page.tsx, payment-rails.module.css, payment-rails-charts.tsx. Both figures are
a FAITHFUL PORT, not a redesign: the original drew them imperatively into empty
<svg> nodes on load, and that geometry is transcribed into JSX so they
server-render. Chart color literals are kept as-is so the output matches; the
surrounding chrome uses v3 tokens. Nav: "Pricing" was a plain link and is now a
navGroups dropdown (`pricingLinks` in site.ts) with Pricing and Payment rails,
so the standalone Pricing links were removed from both desktop and mobile in
nav.tsx and MARKETING_ROOT became unused there. /pricing gained an "Explore
payment rails" link in the FAQ intro, which already name-dropped payment rails.
Also .navPopoverItem radius 12px -> 18px, concentric with .navPopover (30px
radius minus 12px padding) so inner and outer curves stay parallel.
NOTE: the dev server in this worktree was crashing and cold-recompiling
repeatedly during this work; the radius was verified against compiled CSS
rather than a screenshot, though the page itself is screenshot-verified.

2026-08-25 — /solutions/wallets: replaced the "Two ways to consume" lane
cards with a new signer-topology section (Cecilia). New component
`solutions/[slug]/wallet-topology.tsx` renders the login / wallet / chain /
queue / signer graph as one inline SVG on a 1280x640 viewBox, using v3 tokens
throughout so it themes with the page. The only new colors are a local
--topo-amber pair for chain nodes and the sync edge, with an
html[data-theme="dark"] override, since v3 has no amber token. Under 900px the
SVG and legend hide and a four-step stacked list takes over, carrying the same
information. The two lane cards were NOT deleted outright: they collapsed into
the single laneBand that was already there, now one sentence covering both
APIs plus a link to /products/rest-apis, which preserves the
bring-your-own-agent pitch while removing content duplicated from that page.
Bot and Waypoints imports dropped from wallets-page.tsx as a result.
CAVEAT: the diagram copy was transcribed from a Cecilia-supplied image. No
source doc for it exists in this repo, so the queue-per-public-key and
sync-versus-async resolution claims are UNVERIFIED against actual ACL
behavior and should be fact-checked before this page goes public.
eslint clean; desktop and narrow both screenshot-verified.

2026-08-25 — /solutions/defi rebroadened from vault operations to DeFi
generally (Cecilia). Copy pass only: no component, CSS, or structural change,
since every vault/NAV string was inline in defi-page.tsx and
execution-architecture.tsx. New headline is hers verbatim apart from DeFi
capitalization: "DeFi with controlled agent action. AI-driven liquidity
management with security." Hero fixture keeps the same three-row marketList
component but now shows a venue comparison with policy verdicts, where Morpho
at 4.47% is BLOCKED for exceeding risk band A while Aave at 4.11% is SELECTED.
That reuses the existing data-outcome colors (drift = pink, reconstructed =
blue, reported = neutral). The two path cards became agent-decides versus
bring-your-own-model, which mirrors the Agent/Pipeline API split used on
/products/rest-apis. NAV Sentinel and Vault ChangeSet loops became Liquidity
Router and Yield Manager. The only surviving vault reference is deliberate:
Settlement Copilot still mentions shadow NAV for managed vaults, so the
GTM-study wedge is not lost. eslint clean; screenshot-verified.

2026-08-25 — Landing (marketing) polish in worktree
`.codex/worktrees/5bf7/aomi-widget`, working tree only. (1) Nav: added
`.root button { appearance: none }` in marketing.module.css. Safari was
painting the native macOS push-button bezel on hover over nav triggers such as
Products, because nothing reset the native control appearance. (2) Copy:
"wherever your agents work" became "where your agents work" in
_v3-shared/products/cli-mcp/page.tsx, which renders at
/products/agentic-toolings. (3) Grid backgrounds removed from the fintech hero
(dropped the .sectorHeroGrid overlay div plus the gradient layers) and the
plugin-sdk hero. Trading, wallets, and NFT heroes still carry the 54px grid.
(4) rest-apis "One Action" showcase: the confirm sheet had picked up
`aspect-ratio: 1.24 / 1` plus `margin-top: auto` on its buttons, which
stretched the card and left a dead band. Both removed so the sheet hugs its
content, matching the Aomi x Para artifact
(claude.ai/code/artifact/41e1aa60-292f-439b-94a4-6a931bb65ecb). (5) Same
showcase: the type panel no longer sits inert while the tabs slide. The
interface text is deliberately identical across tabs, since "one contract,
three sources" is the section's claim, but each example now lights only the
fields it fills and dims the rest, with a matching chip legend under the code.
Agent lights warnings, Pipeline dims both warnings and expiresAt, Safe lights
expiresAt. (6) Same showcase: added a full-width raw HTTP request panel above
the type-and-sheet pair, which is the part that genuinely differs per source.
Agent shows one POST /v1/agent/chat with headers and body. Pipeline shows the
stage, stage, commit sequence from the Developer API artifact
(claude.ai/code/artifact/ef3ef8f4-31a6-47aa-a6ed-30345a60932b), since a
two-leg batch is not a single build call. Safe shows the cursor GET plus a
deferred result POST. Highlighting uses a small local tokenizer, not the
ClientExample one. eslint clean; all three tabs screenshot-verified.
NOTE: this worktree's landing dev server runs on port 3001, not 3000.

2026-08-24 — CI PROGRESS BAR ON THE DEPLOYMENTS TAB (branch
  `feat/deploy-ci-progress-bar`). Importing/redeploying an app from a linked
  repository showed one static line ("Building… (building)") for the whole
  2–4 minute CI build: no bar, no elapsed clock, no link to the run. The
  onboarding deploy step already drew a bar from `deploymentProgress`; the
  project deployments tab never used it.
  - New `deploy-flow-progress.ts` maps CI state onto a whole-pipeline percent
    (deploy 4% → CI 12–78% → activate 96% → live 100%), monotonic across a
    transient `no_ci`/`failed` poll, and carries `ci.url` forward.
  - `DeployFlowState` variants now carry an optional `progress`; the hook also
    exposes `deployStartedAt`. `redeploySource` sets progress at every stage,
    including both activation-failure branches and the catch.
  - The CI url is captured at the poll callback, not in `onProgress`:
    `waitForDeploymentReady` throws on a terminal `failed`/`no_ci` status
    before reporting progress, so a build that fails on its first poll would
    otherwise reach the catch with `ciUrl: null` and lose the run link exactly
    when it matters. Pinned by a hook test.
  - New `ui/deploy-progress-bar.tsx` renders the message, percent, mm:ss
    elapsed, a "CI run" link, and an accessible `role="progressbar"`; error
    turns the bar red and drops the percent. Replaces the old text-only line.
  - Verification: 120 deployments tests + 12 hook tests pass, `pnpm type-check`
    clean, `pnpm lint` clean (3 pre-existing warnings). NOT visually verified in
    a browser — the bar only renders during a live deploy against a real
    backend, which is not reproducible locally.
  Untouched: the diverged `apps/portal` copy of the deployments tab, and the
  onboarding deploy step's own bar.

2026-08-22 — WALLET/USER-STATE CONTRACT DESLOP (branch
  `claude/multi-wallet-cli-366238`, working tree only, not committed). The FE
  now speaks the backend canon: wire key `svm` is canonical (`solana` stays an
  ingest-only alias), the CLI derives wallet families from configured state
  instead of app-name/key-shape sniffing, and the Solana cluster is persisted
  at `wallet set --solana` time so display == state file == wire.
  - `aomi wallet current --json` emits `family: "svm"` (was `"solana"`); the
    human line now appends the cluster. New exact-shape pins in
    `test/cli/cli-wallet-current.unit.test.ts`.
  - `wallet set --solana` accepts `--cluster` and persists
    `cluster ?? existing ?? solana:mainnet`. Legacy state files with an SVM
    address and no cluster get stamped `solana:mainnet` on load
    (`CliSession.ensureSvmClusterInvariant`), including when one-shot config
    derives an SVM address after loading an existing session. Runtime cluster
    resolution is centralized in `CliSession.resolvedSvmCluster`;
    `setSvmCluster` deleted; `buildCliUserState` never injects a cluster.
  - `buildCliUserState` rewritten: evm/svm blocks emitted iff their address is
    configured; the `isSolanaApp` app-name list and base58 `--public-key`
    sniffing are gone (both copies, incl. `resolveSvmAddressForChat`).
    Deliberate break: a non-0x `--public-key` now fatals instead of silently
    misrouting. Latent bug fixed: SVM-only sessions now sync wallet state
    (guard was `!next.publicKey`).
  - React: `wallet:state_changed` serializes exactly current backend
    `ProviderState` (`is_connected`, `provider`, `provider_label`,
    `auth_method`), excluding FE-local and account-identity fields. Dev drivers
    emit canonical `svm:` key with `capabilities` as `string[]`.
  - `normalize.ts` evm-array collapse documented + pinned as BE-faithful
    (`EvmWalletState::primary()` = first entry; non-object first entry → no
    evm block).
  - Client version bumped 0.5.2 → 0.6.0; React bumped 0.6.2 → 0.6.3;
    SKILL.md min client version updated; both tracked `dist/` trees rebuilt.
    The fully stale `docs/generated/userstate-shape-reference.md` and all live
    references were removed.
  - Verification: 523 client+React tests passed (28 opt-in integration tests
    skipped), typecheck passed, package builds passed, and lint had 0 errors
    plus 6 unrelated existing Portal warnings. Built-CLI staging smoke used an
    isolated `AOMI_STATE_DIR`: `wallet set --solana --cluster devnet`,
    `wallet current --json`, a completed chat turn, and a backend state read all
    agreed on the generated address and `solana:devnet`; returned top-level
    keys were `connection`, `ext`, `svm`, with no `solana`. GitHub run
    32495394206 proves staging-1, staging-2, migration, and edge verification
    all succeeded for current backend main `2fae659e`.
  PENDING: Cecilia commits the working tree. Out of scope, deliberately
  untouched: `AomiAuthWalletFamily`/`wallet_family` auth contract, portal MCP
  tool schema (`const: "solana"`), all ingest tolerance for legacy shapes.

2026-08-20 — APP FAILURE VISIBILITY (branch `fix/app-failure-visibility`; the
  backend half is product-mono `fix/app-tool-schema-provider-rejection`).
  Staging `?app=somm-agent&application_id=2937568` 503'd on open, then accepted
  "hi" and never answered. Three separate defects:
  - **Provider-rejected tool schema (root cause, backend).** somm-agent declares
    `get_risk_snapshot` as an object schema with no `properties`; OpenAI rejects
    the ENTIRE completion request, so every turn in the app died silently.
    `normalize_tool_schema` now repairs object nodes recursively against a
    stated grammar, and `tool_schema_provider_error` decides what is left;
    `DynApp::build_with_key` drops anything still invalid instead of advertising
    it. One malformed tool can no longer silence a conversation.
  - **The builder was never told.** `tool_invocations` is written only for
    completed tool calls, so a provider rejection wrote nothing and Build →
    Operate → Logs stayed empty while the app was dead. New
    `record_app_error` writes app-attributed rows for dropped tools and refused
    turns; `post_completion` now reports its outcome so one failure records one
    row, not a completion error plus an `empty_provider_response`.
  - **The user saw a silent hang.** `system_error` was a toast only, and the
    backend drains `system_events`, so a reload lost the explanation entirely.
    New durable `MessageSender::Notice` (persisted, projected, excluded from LLM
    history — `System` is dropped at all three layers and could not serve).
    Frontend: `createThread` retries 502/503/504 through the app-warm window
    (4xx, notably 402, still surfaces at once); `system_error` also appends an
    inline notice keyed to `event.sessionId`, not the visible thread; the
    payment-required card generalized to any `aomiNoticeKind`.
  Repeatable check: `scripts/check-app-turn.sh somm-agent 2937568` drives a full
  turn and asserts an answer came back. Exits 1 against staging today; should
  exit 0 once both branches deploy.

  PENDING: neither branch is deployed, so the durable-notice reload behavior and
  the builder log row are verified by tests only, not on staging. Follow-up
  worth doing: deploy-time schema validation, so a builder learns about a bad
  tool schema before shipping rather than after users hit a dead chat.

2026-08-12 — MCP CHAT PARITY IMPLEMENTED. `/api/mcp` now exposes only
  `aomi_chat`, `aomi_check`, `aomi_interrupt`, and `aomi_list_sessions` over a
  shared stateless JSON-RPC shell; the unchanged direct discovery/execution
  funnel moved to `/api/mcp/direct`. Agent turns use the canonical
  `/api/threads` + `/api/thread/{chat,state,interrupt}` kernel paths with both
  thread headers and BFF-minted AccountBearer. New sessions are account-bound,
  headless turns hydrate primary EVM/SVM wallet addresses from `public_keys`
  without fabricating active mainnet networks. `aomi_chat` accepts an optional
  authoritative EVM chain id or canonical supported Solana cluster; omission
  leaves both network fields absent. Message cursors return transcript deltas
  without dropping the backend's drained system events, and checks compress
  tool/task activity. Manual wallet requests
  return `awaiting_user`, redacted request summaries, and a working portal
  deep-link; armed auto-signing wallets need no MCP signing tool. The existing
  origin-scoped OAuth protected-resource metadata covers both MCP routes.
  Local E2E verification covers SIWE, dynamic OAuth registration, explicit
  consent, PKCE exchange and refresh, both MCP tool inventories, real async
  reply deltas, account session list/resume/interrupt, a funded local-chain
  transaction reaching the manual-wallet approval gate, and `agent-browser`
  opening the exact linked transcript. The message cursor deliberately holds
  the runtime's mutable streaming tail until it becomes a completed delta.

2026-08-12 — **Cross-chain wallet approvals now switch EVM networks automatically.**
  `RuntimeTxHandler` compares every staged transaction's chain with the connected
  wallet before simulation, rejects unsupported chains with actionable copy, and
  invokes the adapter's network switch before simulating or sending. Wallets that
  cannot switch get manual-switch guidance; a rejected wallet popup continues
  through the existing request-rejection path. The approval handler tells the
  shared executor when it already selected the target chain, preventing a second
  wallet prompt while direct executor callers still switch when needed. The shared
  AA executor also keeps an unknown current chain as `undefined`, so it attempts a
  switch instead of masking the state as already on the target chain. Regression
  cases cover switch ordering, exactly-once selection, same-chain behavior,
  unsupported/missing adapters, rejected prompts, and unknown/current AA execution
  state. The joint backend work merged first in product-mono #973. Publishable
  versions are `@aomi-labs/client@0.4.7` and `@aomi-labs/widget-lib@1.4.30`.

2026-08-08 — DEPLOY-SURFACE BUGS, BE SIDE (product-mono worktree
  `~/Code/product-mono-worktrees/deploy-feed-platform-scope`, branch
  `claude/deploy-feed-platform-scope` off origin/main f5d421933; all changes
  uncommitted). Root causes established by probing staging directly with a
  portal-minted service bearer (apps/portal/.env.local).
  - ENVIRONMENT TAB `list_secrets failed (503)`: the 503 is the Cloudflare
    Worker's, not the backend's. With APP_AVAILABILITY_ROUTING on, ANY
    `/api/*?application_id=N` request is availability-probed and hard-503s
    when no origin has the app's artifact loaded — which is every deactivated
    app (staging probe: 4 of Cecilia's 5 apps 503'd; only the loaded
    world-markets passed). `infra/cloudflare/worker/src/index.js` now exempts
    `/api/_internal/*` (service traffic ABOUT an app, not TO it). Worker tests
    37/37, new test mutation-checked.
  - FEED vs PROJECT HISTORY (4 vs 1): on main both reads are projection-only
    by project_id and CONSISTENT; the data itself is gone — migration
    `20260806010000_project_model.sql` ran `DELETE FROM deployments;` and the
    promised import migration never existed. Pre-cutover manifests also fail
    strict deserialization (no `project_id`) and are silently skipped. Added
    the explicit recovery door: `SourceRecord.project_id` is `#[serde(default)]`,
    the projection writer rejects `project_id <= 0`, and new service-only
    `POST /api/integrations/github-app/user/projects/:id/deployments/import`
    (`Project::import_deployments`) scans the platform repo's deployment
    branches + deploy branch, stamps the owning project, and idempotently
    upserts. Route + route-manifest test + Worker manager-route pattern + test.
  - REQUIRED-SECRETS 500 ON LEGACY TAGS: staging audit showed
    `GET /user/projects/:id/required-secrets` 500ing with "invalid platform
    release tag `latest`" for any project holding a legacy `app_release_tag`
    DEFAULT-'latest' row — one bad row failed the WHOLE Environment/deploy
    gate ("Required secrets could not be verified"). `Project::required_secrets`
    now degrades an unparseable tag to "no release ⇒ no slots" (warn-logged);
    the "no deployment projection" 500 for parseable tags is kept — that one
    is real integrity signal and is what the import door repairs.
  - APP-STATUS 403 (aomi-build CLI): `PlatformHandler::get_app()` authorized
    `Action::ReadPlatform`, which app-scoped activation tokens are forbidden
    from. It now resolves the named app row first and authorizes
    `Action::ReadApps { app_ids: [app.id] }` — the lattice's app-token rules
    for ReadApps are already unit-tested in activator.rs.
  - Verified with ALL three fixes (fresh build after the disk-space incident):
    cargo check -p manager clean; cargo test -p manager 138 passed/19 failed
    == clean-main baseline (the 19 are the hosted-DB guard refusing an
    exported hosted DATABASE_URL — pre-existing, environmental); worker tests
    37/37. PENDING after deploy: re-probe staging (secrets reads should 200),
    then invoke the import for world-markets (project 1646) to restore its
    history. NOT a bug: the "0.3.2 vs 3.1.0" report — 3.1.0 is the required
    aomi-sdk crate version (workspace pins =3.1.0); 0.3.2 is the world-markets
    app's own DynManifest.version. The stale-descriptor issue behind it is the
    runtime dlopen hot-reload seam (backend reconcile.rs), owned by another
    Codex session mid-experiment — deliberately not touched here.

2026-08-08 — OPERATE PAGES IGNORED THE SELECTED PLATFORM (apps/build, working

2026-08-08 — OPERATE PAGES IGNORED THE SELECTED PLATFORM (apps/build, working
  tree on `claude/deployment-records-mismatch-79b0a0`). Observability listed 5
  projects across platforms while `/projects` listed the 2 on
  `world-market-apps`. The account-wide manager batches (observability,
  transactions, usage, logs, payments) are deliberately unscoped — the
  per-project read rejects partner-bound projects as not launch-relevant on the
  default platform — but the BFF read `?platform=` only as a **cache key** and
  never narrowed the response.
  - `operateSession` gains `platformProjects()` alongside `projects()`:
    `listUserProjects({ platform })`, i.e. the exact list `/projects` renders.
    `projects()` stays account-wide because ownership checks need it.
  - The five account-wide routes now filter their rows through `onPlatform()`
    against that id set. The manager call stays account-wide; only the response
    is scoped, so a partner-bound project is still reachable — on its own
    platform's page. Rows with no project (shared partner settlements) are kept.
  - `operatePaymentsRoute` now reads the source list (in `Promise.all`, off the
    cache the snapshot warmed) where it previously never did.
  - Settings → Secrets had the same fault one layer up:
    `settings-secrets-panel.tsx` called `useProjects()` with NO platform (the
    only such call site left), so it listed all 5 account projects and a row
    for an off-platform project led to an Environment tab whose secrets read
    503s. It now takes `usePlatform()` and routes through `platformHref()`, so
    following a row keeps the platform instead of dropping to Community.
  - Verified: apps/build vitest 419 passed/1 skipped, tsc/eslint/prettier clean.
    6 scoping tests mutation-checked (they fail when `onPlatform` is a no-op /
    when the panel drops its platform argument).
    The 4 pre-existing failing test FILES (deploy-dashboard, deploy-step,
    live-panel, oneshot-wizard — collection errors) are unrelated and unchanged.
  PENDING (backend, product-mono — NOT fixed here): the global deployments feed
  and a project's Deployments tab are structurally different reads, so they
  disagree. `user_source_deployments` (github_app.rs:988-1043) is DB projection
  **plus a GitHub manifest fallback**; `user_deployments` (github_app.rs:1047+)
  is projection-only and explicitly "never scans GitHub", filtered on
  `deployments.platform`. Any deployment with no projection row under the
  queried platform shows on the project page and is invisible in the feed —
  which is why world-markets showed 4 deployments and the feed showed 1.
2026-08-10 — BROWSER RESPONSE LATENCY SIMPLIFICATION. Reduced the earlier TTFT
  design to frontend mechanisms that work with the existing backend contract:
  one shared empty-thread prewarm promise, a single-flight visibility-aware
  polling timeout, and removal of the synthetic 500 ms completed-answer stream.
  Removed turn IDs, provisional-text state, and `assistant_text_started` client
  handling. Kept the cross-origin origin-bound widget-session guard around the
  Portal's bearer-independent Thread state/SSE reads. Prewarmed threads remain
  durable after x402 so retry uses the same thread. Verified all 1,467 root
  tests, 2 configured registry trace tests, repository lint, client typecheck,
  publishable tarballs, and client/React/registry builds. Portal typecheck
  remains blocked by the existing mixed Para dependency graph
  (`@getpara/web-sdk` 2.24 vs 2.19), outside these files.
2026-08-04 — PROJECT HOME "KEYS MISSING" FALSE ALARM (apps/build, committed
  on `feat/build-new-app-two-starts`). The Environment card warned whenever no
  key was set
  (`envReady = secretCount > 0`), so every project that declares no required
  key at all — including a fresh one with no apps — read as broken.
  - NEW `tabs/environment-card.ts`: pure `environmentCard()` mirroring the gate
    the rest of Build enforces (a declared required slot with no value), in
    order error → loading → missing → set → none-required. "No keys required"
    is `good`, not `warn`.
  - Warn state now carries concrete detail instead of the glossary line:
    "2 required keys not set for somm-agent: OPENAI_API_KEY and
    ALCHEMY_API_KEY. Set them in Environment before deploying." (names capped
    at 4, then "and N more"). The "Next" block reuses that same sentence.
  - A failed read is "Unavailable" with the error text, and `blocked: false` —
    nothing is KNOWN missing, so it must not read as a key fault.
  - home-tab now calls `loadRequiredSecrets()` (it only loaded `secrets`
    before) and gates on source apps ∪ apps the check named, same union
    deployments-tab uses.
  - Verified: apps/build vitest 452 passed/12 skipped (72 files), tsc/eslint/
    prettier clean; both states driven in a local dev server against stubbed
    BFF reads.

2026-08-04 — NEW APP: TWO STARTS (apps/build, committed on
  `feat/build-new-app-two-starts`). `/operate/
  deployments/new` no longer assumes the template. Signed-in users get two
  cards — "Start from the template" (the existing Onboarding/OneshotWizard) and
  "Import from GitHub" (the existing `RepositoryConnector`) — then the chosen
  flow renders in the same framed panel with a "Choose a different start" back
  button.
  - `new-project.tsx`: card picker + `?mode=template|import` kept in sync via
    `history.replaceState`, so reload and back/forward stay on the chosen flow.
  - `new-project-mode.ts` (NEW, no `"use client"`): `NewProjectMode` +
    `newProjectMode()` parser. It lives outside the component because the route
    parses `?mode=` on the server — calling it from the client module threw
    "Attempted to call newProjectMode() from the server".
  - Resume guard: `resumingTemplate()` re-opens the template card when the
    GitHub round-trip returns (`installation_id`/`deployment_id`/
    `launch=personal_required` on the URL, or a saved `pendingInstall`). A
    stale stored `installationId` deliberately does NOT count — it would pin
    every later visit to the template card.
  - De-duplicated the import entry point: the inline connect form is gone from
    the Projects index; that page now renders only the extracted
    `ConnectionResultBanner` (GitHub still returns to `/projects`, so the
    outcome has to render without the form that started it).
  - Verified: apps/build vitest 441 passed/12 skipped (71 files, incl. new
    `new-project.test.tsx`), tsc clean, eslint clean, prettier clean; both
    flows driven in a local dev server.
  Codex review follow-up (same day):
  - resumingTemplate() also resumes on a saved `oneshot.deploymentId` that is
    not yet `live` — the wizard only mirrors it into the URL while mounted, so
    leaving Build mid-deploy and returning through the nav used to land on the
    picker. `live` still falls through to the cards.
  - `?mode=` now syncs on change (ref-guarded, so it never races the resume
    effect on mount): the App Router reuses this instance across a soft nav, so
    a "New app" link carrying no mode has to return the user to the picker.
  - Both fixes mutation-checked (tests fail when the fix is backed out) and
    `ConnectionResultBanner` got its own tests.
  - Review's P1 ("Import depends on unmerged BE") does NOT hold:
    codex/build-existing-repo-oauth landed on product-mono main as 0b6eb9582
    (PR #923, 2026-08-03). `github_app_oauth_start` reads `return_to`,
    `validate_build_return_to` allowlists it, and `redirect_url()` honours it.
    NOTE for anyone extending returnTo: validation requires the URL's query to
    be EXACTLY `platform=<signed platform>` and the path to be `/projects` or
    `/operate/deployments/new` — putting `&mode=` on a returnTo would 400,
    which is why the resume state is derived instead.

2026-08-04 — **Sidebar wordmark is now a product switcher.** The chat sidebar
  header (`apps/shadcn-registry/src/components/assistant-ui/threadlist-sidebar.tsx`)
  no longer links out to `aomi.dev`; the logo · "Aomi" · chevron row is a Popover
  trigger that also carries a `CHAT` badge (same treatment as Build's wordmark
  badge in `apps/build/src/components/brand/aomi-logo.tsx`). The menu lists Aomi
  Chat (current, checkmarked) and Aomi Build → `https://build.aomi.dev` (new tab),
  styled off the thread-list row menu (`bg-aomi-raised` / `border-aomi-overlay-border`
  / `hover:bg-aomi-hover`). Entries are data: `DEFAULT_SIDEBAR_PRODUCTS` +
  `SidebarProduct` are exported from the package index, and `AomiFrame.Root` takes
  `products` (pass `null` for a plain wordmark) and `currentProductId` so embedders
  can override or hide the Aomi cross-links. Portal keeps the defaults. Verified in
  the browser against portal on :3001 in light and dark. Note: `apps/build`'s own
  header wordmark is still a plain link to `/` — it has no switcher yet.

2026-08-03 — **Para EVM signing fix hardened before commit.** Review of the
  working diff found the registry build broken: `para-evm-runtime-provider.tsx`
  was imported by the registered `para-plugin.tsx` but missing from the
  `aomi-para-provider` file list in `apps/shadcn-registry/src/registry.ts`, and
  `@getpara/wagmi-v2-connector` was missing from its `dependencies` — a
  `shadcn add` would have installed a broken component. Both added; build green.
  Correctness fix in `execution/wallet-execution.ts`: the new sequential
  receipt-wait only counted a leg as executed after its receipt confirmed, so a
  non-revert wait failure (RPC timeout) reported an already-broadcast leg as
  un-run and `runtime-tx-handler` blanket-rejected — re-queuing a mined tx, the
  exact double-execution the handler guards against. Now tracks broadcast legs
  and emits a partial for them, excluding a leg that mined `reverted`.
  Also: failure cooldown on the Para wagmi auto-connect effect (was retryable on
  every store dispatch with no backoff), shared `PARA_SESSION_UID` constant in
  `para-brand.ts` replacing the duplicated `"para-session"` literal, dropped an
  unnecessary `as unknown as CreateConnectorFn` double cast. 295 registry tests
  + 1287 root tests pass; typecheck, eslint, prettier, registry build clean.
  NOTE: the receipt wait applies to **every** sequential wallet send, not just
  embedded/Para — non-Para wallets now pay a block confirmation between legs of
  any non-atomic batch. Intentional (safer default), but call it out in review.

2026-08-02 — PLATFORM-BINDING INVARIANT, E2E (FE worktree platform-switch +
  BE worktree somm-repo-connect/product-mono branch
  codex/build-existing-repo-oauth, both uncommitted; BE sits on top of the
  merged h4n0 PR #907). Design: a source is either DISCOVERED (unowned,
  unbound, invisible) or CLAIMED (one owner, exactly one platform, visible on
  that platform's page only); Build has no unscoped view — no `?platform=`
  means Community.
  BE (product-mono):
  - NEW migration 20260803000000_app_source_platform_backfill.sql — bucket 1
    infers bound_platform_id from apps' platform_id (multi-platform rows
    skipped for operator repair, verify-SELECT in the header), bucket 2 binds
    owned-but-unbound to community, then CHECK app_source_owned_implies_bound
    (owner NULL OR platform NOT NULL). All write paths audited: oneshot
    insert + claim_user_and_platform set both, webhook upsert sets neither,
    bind_platform only adds — admin-bound-unowned stays legal.
  - endpoints/github_app.rs: LaunchSourceKind (oneshot-everywhere +
    deployed-app grandfathering + Other) DELETED; platform-scoped
    list/latest-deployment/history/loader now gate on source_on_platform()
    equality; launch_source_kind dropped from the wire; presenter dissolved
    into free deployment_json{,_from_row}; app_loaded lost its vestigial
    platform param (obs monitoring/detail/batch updated).
  - handler.rs: check_source_deploy_platform is STRICT equality (unbound only
    passes preflight, mirroring check_source_deploy_owner); grandfathering
    deleted — cross-platform rows (bound A, serving on B) now 403 redeploys
    until operator repair; gate tests rewritten (8/8 green).
  - oauth/start: `mode` param KILLED — with a repo the backend checks
    repo_has_installation() (new GitHubApp helper, 404→false) and returns the
    OAuth consent URL when covered, install URL when not; no repo → install.
  - Verified: cargo check -p manager --tests clean; gate unit tests 8/8.
    DB-backed tests refuse locally (hosted-DB guard) — CI covers them. No
    clippy/build run (Cecilia: no memory-heavy ops).
  FE (this repo):
  - platform.ts: platformParam now DEFAULTS to DEFAULT_DEPLOY_PLATFORM
    ("community"); usePlatform returns string (defaults too); hardcoded
    "community" literals in onboarding/platform-switcher/home-redirect
    replaced with the constant; deployments/new backHref always Projects.
  - githubAppInstallUrl lost `mode` (packages/deploy client + build client);
    launchSourceKind deleted from UserSource type + camel mapper.
  - use-projects.ts: hasApps filter DROPPED — claimed zero-app sources render
    as "Connected — not deployed yet" (project-deployment-status empty
    branch), fixing connect-success-banner-over-missing-row.
  - docs/fe-deploy.md oauth/start rows updated (backend picks the ceremony).
  - Verified: apps/build vitest 416 passed/12 skipped (69 files),
    packages/deploy 136/136, tsc clean both, eslint clean on touched files.
  2026-08-03 follow-up — BUILDERS DUPES + REDUNDANT FIELDS (from Cecilia's
  Supabase screenshot): the live DB has DUPLICATE builders.github_user_id rows
  (4738254/h4n0 twice) because 0714's CREATE TABLE IF NOT EXISTS no-opped on a
  pre-existing table and its UNIQUE never materialized — every ON CONFLICT
  (github_user_id) (claim ceremony, 0802 backfill) would error at runtime.
  Fixed in-place in the 0802 migration: idempotent dedupe (merge onto MIN(id),
  carry github_login, repoint app_source/bot_registrations/builder_model_keys)
  + guarded ADD CONSTRAINT builders_github_user_id_key. 0803 also now flips
  app_source.bound_platform_id FK from SET NULL to RESTRICT (SET NULL would
  collide with the owned-implies-bound CHECK). Redundant-field verdict:
  app_source.github_user_id + its index are the only redundant ones; Rust no
  longer references them; the SQL drop is documented in the 0802 header and
  DROPPED at the end of 0802 (Cecilia accepted the brief rolling-window
  breakage in exchange for a one-cycle removal — no follow-up migration).
  PENDING/handoff: run the migration's verify-SELECT against staging+prod and
  hand-repair any multi-platform or cross-platform rows BEFORE deploying the
  strict gate; deploy order migration → BE → FE; AOMI_BUILD_URL must be set
  on staging/prod backends or return_to is rejected; commits/pushes are
  Cecilia's (BE branch also has 4 unpushed commits incl. the #907 merge).

2026-08-03 (staging smoke) — **Staging API verified healthy; DOMAIN.md route
  table found stale.** Live smoke of `api-staging.aomi.dev` (the hostname
  `api.staging.aomi.dev` does not resolve): health, auth boundaries, OAuth
  start, direct `/api/thread/chat` round-trip, and browser chat through
  `chat-staging.aomi.dev` all pass. Finding: the deployed backend serves ONLY
  the `/api/thread/*` + `/api/threads` surface; legacy `/api/chat`,
  `/api/state`, `/api/sessions`, `/api/session/*` 404 by design.
  `packages/client` already uses the new routes, but `specs/DOMAIN.md`'s
  "Backend Endpoints" table still documents the legacy paths (and claims
  archive/unarchive routes don't exist — they do now, per staging OpenAPI).
  **Pending:** refresh DOMAIN.md's endpoint table from
  `/api/openapi.json` + `packages/client/src/client.ts`.

2026-08-03 (later) — **PR #7: canonical sign-out centralized in widget-lib.**
  Review follow-up (Codex + Claude review agreed): DualWalletBar's disconnect
  fallback called only `adapter.disconnect()`, skipping account/widget session
  teardown — latent, since portal (the only `accountMenu` consumer) supplied
  its own correct `onDisconnect`, but any future consumer would have leaked
  live backend sessions behind a "Connect wallet" chip. The
  signOut→disconnect sequence lived in three places (wallet-picker.tsx:542,
  portal's `disconnectPortalAccount`, the incomplete fallback); now it is ONE:
  new `lib/wallet-kit/account/sign-out.ts` exports `signOutAndDisconnect()`
  (`try { signOutAccount } finally { disconnect({family:"all"}) }`), used by
  WalletPicker and as DualWalletBar's default; portal's `onDisconnect` +
  `disconnectPortalAccount` deleted (hook comment documents why). Also fixed
  in the same path: `handleDisconnectConfirm` now catches (was an unhandled
  rejection when a host `onDisconnect` rethrew; dialog stays open for retry,
  `console.warn` per house idiom) and the confirm-dialog backdrop honors
  `busy` like the Cancel button. New file registered in `registry.ts`
  (build:registry validates) and exported from `wallet-kit/index.ts`. Tests:
  registry fallback ordering + sign-out-failure cases added (7 pass), portal
  onDisconnect tests replaced with an is-undefined assertion (4 pass); full
  registry suite 296 pass (package-boundary tests need `build:package` first
  or they ENOENT on dist/ — environmental, not code). Portal `type-check` and
  registry `tsc --noEmit` clean. Pending from review, NOT done: AccountMenu
  a11y (no Escape-close, rows not `menuitem`), `networkLabel.slice(0,8)` hard
  truncation, multi-wallet chip collapses to primary wallet in account-menu
  mode (verify against mock), portal→registry DOM coupling via
  `[data-aomi-network-select-trigger]` click.

2026-08-03 — **PR #7 (feat/portal-account-menu) sign-in wiring + CI fix.**
  Green CI blocker found and fixed: `pnpm run build:registry` failed with
  `Registry item "control-bar" is missing internal files` because
  `account-menu.tsx`, `account-menu-types.ts` and
  `disconnect-confirm-dialog.tsx` were added to `components/control-bar/` but
  never listed in `src/registry.ts` (the build validates every *relative*
  import in a registry item resolves to a listed file). Also fixed a
  `tsc --noEmit` error in `dual-wallet-bar.test.tsx` — the `walletModalRows`
  mock was missing the required `source`/`status`/`actions` fields.
  **Behaviour fix:** the sidebar AccountMenu "Sign in" and the Settings gate
  retry both called `openAccountUI()`, which opens Para's *account
  management* modal (`ACCOUNT_MAIN`) — the email/profile popup — and can
  never mint the missing Aomi session. Both now call `connect()`
  (`AUTH_MAIN`), which re-arms the provider credential exchange. Removed a
  dead `accountStatus === "error"` branch: a failed exchange sets status back
  to `"ready"` and only populates `accountError` for 409, so the chip now
  shows `accountError` when present. Session probe no longer burns the full
  30s budget once the exchange has settled (short settle grace instead), so
  Settings stops sitting on "Connecting your account…" and reaches the
  actionable "Finish signing in" gate. `widget-lib` at 1.4.18 (main: 1.4.16).

  **Preview QA result — `PARA_JWT_AUDIENCE` is NOT the blocker.** With the
  error now visible, preview returns the semantic **409
  `already_linked_to_another_account`**, not a 400. A 409 means the Para JWT
  verified and the exchange reached identity linkage, so the audience env var
  is correct on preview. The real condition is data, not config: that Para
  identity is already linked to a *different* Aomi account (leftover from
  earlier testing), and the backend refuses to move a login factor silently.
  Remedy is per the error copy — sign in to the owning account and unlink
  there, or use a different Para identity. No code fix applies.

  **Follow-up fix (this change):** `accountError` was being piped into the
  chip's `secondaryLine`, a single `truncate`d row, so the 409's full sentence
  rendered as "This wallet or sign-in m…". Split the two surfaces: added
  `noticeLine` to `WalletAccountMenuOptions` / `AccountMenu` for wrapped
  full-length copy in the menu header, and the chip now shows the short
  "Sign-in needs attention". Rule going forward: chip copy stays under ~25
  chars, backend error strings go to `noticeLine`.

  **Conflict diagnosis (this change).** The 409 has a `signalType` of
  `identity` | `wallet` | `email` that decides the remedy (unlink a login
  method vs unlink a wallet), but it never reached the user: the better-auth
  path threw `APIError("CONFLICT", { message })` with no `signalType`, and the
  client's `extractErrorCode()` kept only `error`/`message` anyway. Now
  `provider-plugin.ts` includes `signalType` in the error body (better-call
  types it as `{message?,code?,cause?} & Record<string,any>`, so extra fields
  serialize), and `AomiAccountRequestError` carries it into one of three
  specific messages. `/v1/account/provider/exchange` already spread it via
  `...result`. NOTE: this is the first `packages/account` file in PR #7 — one
  additive error field, but it breaks the "UI-only" property.

  **CI gap found, NOT fixed here.** Root `vitest.config.ts` only includes
  `apps/portal/src/{app,server}/mcp`, `lib/widget-auth`, and
  `app/api/*/route.*`, so ~40 portal test files under `components/`,
  `features/`, and most of `lib/` never run in CI — including this PR's
  `use-portal-wallet-account-menu.test.tsx`. Registry tests do run, via
  `pnpm --dir apps/shadcn-registry exec vitest run`. Widening the include is
  its own PR; expect pre-existing failures to surface.

2026-08-02 (~17:45) — **ds13 RECORDED — catalog COMPLETE.** Post-fixer-session
  run (their parseTxIds ordering fix + dist rebuild + Aave gateway address
  correction + my backend rebuild/restack): attempt 3 landed
  wrap→approve→supply 2 WETH→borrow 2,000 USDC on Compound v3 IN DEPENDENCY
  ORDER (first production proof of the ordering fix), 5 txs mined, 2,000.0
  USDC verified on-chain, agent closes with a chain-read health-factor
  calculation (3.01, math shown). 57s @2x + 30s social delivered.
  Residual rough edge (cost attempts 1-2, reported to the fixer session):
  compound_v3 rate-read tools intermittently fail "Argument count
  mismatch: expected 1 arguments, got 0" — agent recovers but burns turn
  budget. **Every authored scenario now has a shipped take**: ds2, ds4,
  stake-shootout, money-legos, ds13, ds14 (EVM, this session) + ds6, ds10,
  ds11 (SVM, -svm session); eval PASS on the destination leg; full
  BD/social/docs cut derivation for all.

2026-08-02 (~17:25) — **ds14-bridge-round-trip RECORDED** (80s @2x + 43s
  social, delivered): 4 ETH mainnet→Base (canonical leg in the first pass,
  Across in the shipped take), agent reads the TRUE arrival off Base,
  picks Across for the return, bridges ~2 ETH back — journal shows the
  AcrossFiller filling BOTH directions (1→8453 fill 0xb0bcbf…, 8453→1 fill
  0xf71af1…), first bidirectional operation. Unblocked by the
  **multi-chain E2E executor fix** (apps/portal/src/server/e2e-wallet.ts):
  the old gate rejected any call whose chainId ≠ the SEED chain
  ("Transaction chain does not match seed"), killing every cross-chain
  scenario's far leg; now one-chain-per-batch is enforced but the chain is
  judged by config + fork probe (15/15 executor tests, incl. new
  non-seed-chain case). GOTCHA: Next dev did NOT hot-reload the server
  module — a stale portal ran the old gate for a full re-roll; restart the
  portal after server/*.ts edits.
  **ds13-cheapest-borrow PARKED** (9 attempts, deterministic): the
  comparison half works beautifully (live Aave 8.86% vs Compound 3.97%
  with shown math, picks Compound) but execution dies on the
  **commit-ordering bug** — batch executes in ascending id order, supply
  runs before wrap, Comet reverts on zero WETH. Also hit the Aave
  native-ETH gateway coverage gap en route. Both bugs + the post-callback
  re-evaluation bug are now owned by Cecilia's fixer session
  ("Fix post-callback turn re-evaluating completed requests",
  local_c514f206…) — full evidence briefs sent to it; ds13 is the repro
  vehicle once its fix lands. Machine-pressure note: daytime takes flaked
  with "fetch failed" whenever free RAM <500MB (portal balloons to ~1.8GB
  — restart it between batches; Cursor's rust-analyzer ~1GB).

2026-08-02 16:15 — SVM shooting session CLOSED. Scoreboard: ds10-sol-unstake
  SHIPPED (attempt 1, 85s; agent quoted real 0.0042 mSOL pool fee, closing
  numbers match chain). ds11-sol-lst-switch SHIPPED (attempt 1 on a
  minutes-old fork after 4 stale-fork failures — freshness rule CONFIRMED for
  LST routes; mSOL 3.5→0, JitoSOL 3.7765, message matches chain). ds9 CHAIN-
  PERFECT but video unusable: post-callback turn RE-EVALUATED the original
  request against post-payment balance and refused a payment it had already
  made (recipient provably holds exactly 150 USDC + fresh ATA) — REAL BACKEND
  BUG: the wallet-callback follow-up turn should reconcile, never re-plan.
  ds12 CLOSED AS BLOCKED after 6 attempts x 3 configs: aggregator multi-hop
  SOL→USDC routes fail simulation on the mirror regardless of freshness
  (GoonFi V2 / Alpha Q thin routes); agent repair behavior correct but
  non-convergent; ds6's pass was route luck. Product conversations to have:
  (1) callback-turn semantics, (2) mirror fidelity vs aggregator routes OR a
  route-stability hint for fork environments. Authoring rule added to ds12:
  scripted turn N+1 requires turn N to leave nothing to ask back (slippage
  question derailed a take). Freshness rule tightened: re-fork every ~30 min
  while shooting, not 2h. mp4s in demo/out/. Backend 8081 + portal 3500 +
  mirror LEFT RUNNING for the video-maker session; rig announced free.

2026-08-02 (~16:45) — **Three-cut derivation SHIPPED** (the original
  one-master-three-cuts vision): demo/capture/to-cuts.sh reads
  markers.json and emits `<id>-social-2x.mp4` (trailing turns fitted to a
  90s real-time window — ask + payoff, no setup) and `<id>-turn<N>-2x.mp4`
  per conversation turn (docs), alongside the existing BD 2x master. Run
  on all four EVM takes: social cuts 28-45s delivered. Gotcha encoded in
  the script: ffmpeg inside a while-read loop MUST use -nostdin or it
  slurps the remaining plan lines (first run silently dropped half the
  cuts). ALSO: two new queue scenarios authored, load-checked, ready when
  the rig frees — ds13-cheapest-borrow (Aave vs Compound rate referee,
  3 turns, chain 1) and ds14-bridge-round-trip (mainnet→Base→back, both
  actors, first Base-side E2E execution; expects the agent to pick Across
  for the return leg since canonical L2→L1 has a 7-day window the
  OpDepositFinalizer deliberately doesn't fake).

2026-08-02 (~15:30) — **money-legos RECORDED + the staged-tx-loss bug FIXED.**
  Root cause (from thread cb69aa17 + portal 500s): the E2E executor runs
  batches sequentially; the Aave borrow leg reverted at estimateGas
  (0x5b263df7) AFTER earlier legs mined, and the blanket-failed
  wallet:tx_complete re-queued ALL ids → retry re-ran the 5 ETH stake into
  an insufficient-funds spiral. FIX (widget worktree, additive, 5 layers):
  server/e2e-wallet.ts tracks per-call txId + returns E2EPartialExecution
  {executedTxIds,lastTxHash,failedTxId,remainingTxIds}; provider throws
  E2EPartialExecutionError; runtime-tx-handler resolves partials instead of
  blanket-rejecting; packages/client session emits TWO tx_complete events
  (success for the mined prefix, failed for the tail) via new optional
  completedTxIds/failedTxIds/failureReason on the transaction result type.
  VERIFIED: new regression test (leg-2 revert → exact partial shape),
  portal 14/14, client 297/297, tsc clean ×3. THEN money-legos recorded
  first try: 7 txs mined, agent close "ids 1–6 all consumed", 1000.0 USDC
  borrowed VERIFIED on-chain; 259s @2x delivered.
  Coordination: SVM cases ds9–ds12 are the -svm session's to shoot (per
  Cecilia); rig handed over after money-legos with merged config — derived
  providers.toml now carries well-formed [solana.mainnet] mirror pin
  (kind/cluster/rpc_url=8899/fallback_urls=[]) — NOTE `evm up` regenerates
  the file and drops this patch; re-apply after any evm up. Their field
  reports: backend booted without SOLANA_MAINNET_RPC_URL reads PUBLIC
  mainnet (0 SOL takes); mirrors older than ~2-3h fail Jupiter/Sanctum
  sims; `test-env svm down/up` broken (wrong pid tracking) — boot surfpool
  directly.

2026-08-02 (~04:20) — **FIRST DESTINATION-LEG EVAL PASS**:
  bridge_base_usdc_to_arbitrum_send_and_fill on claude-sonnet-4-6 — agent
  deposited 5 USDC into the Base SpokePool (9 tool calls, 53s), in-process
  across actor filled on the REAL Arbitrum SpokePool (fill tx 0xd68aec…),
  ALL assertions green incl. FilledRelay + USDC-arrival on 42161. Reports
  archived at demo/out/eval/*.PASS.*.json. Fixes en route (product-mono,
  uncommitted): eval actor-endpoint fallback via provider_manager when
  pids.json isn't tracked (explicit PROVIDERS_TOML runs); Base USDC whale →
  0x498581fF… (Uniswap v4 PoolManager, ~10M) and Arbitrum USDC whale →
  0x2Df1c51E… (Hyperliquid bridge, ~419M) in BOTH funding presets and
  actors WHALES — prior whales were dry/drained (Arbitrum's Binance wallet
  was drained to 0.05 USDC by our own 2×10,000 faucet funding). NOTE: eval
  default model Gpt55 produced a silent 0-token turn — worth a loud error;
  pass --model explicitly for now.

2026-08-02 (overnight batch) — ds2-stake-eth (47s @2x, 5 ETH→stETH executed)
  and stake-shootout (37s @2x, agent COMPARED and chose Rocket Pool: 4 ETH →
  ~3.42 rETH) recorded clean and delivered. Unblocking fix chain:
  (a) `test-env evm up` stamps sim instances `accounts = 1` — anvil's
  genesis prefund is a LOCAL override on every derived mnemonic account
  that shadows forked state after ANY anvil_reset (including the agent's
  own sync-fork tool), so the demo wallet (index 2) read 10,000 ETH
  forever; with one derived account only index 0 is shadowed and truth
  forks through; (b) recorder resyncSimForks() + native-balance mirroring
  onto sims (belt over braces). ALSO: overnight restacks must kill :8081
  before relaunching backend (stale-backend footgun) and never TaskStop a
  recorder mid-reset (orphans the proxy).
  **money-legos PARKED — product bug with hard evidence**: two consecutive
  takes failed identically; on-chain after the take the wallet holds
  5.0 stETH + 4.9999 ETH, i.e. the Lido leg EXECUTED, then the pipeline
  re-staged the SAME leg and the agent reported "wallet balance (4.999)
  below the 5 required". Staged-tx-loss (the unfixed half of
  task_90d7e590): after a successful commit the plan restarts at leg 1
  instead of proceeding to wrap→collateralize→borrow. Threads from
  ~04:05-04:15 2026-08-02 on the demo account show it twice.

2026-08-02 01:40 — Four new Solana case files AUTHORED, none shot (per
  Cecilia: files only). Confidence order for the next recording session:
  ds10-sol-unstake (marinade liquid_unstake, cleanest — proven program, no
  ATA side quest) > ds9-sol-payment (USDC invoice + recipient-ATA creation;
  recipient = deterministic throwaway 4568cBFk…tMoX, key held by nobody) >
  ds12-sol-best-price (Jupiter vs Raydium quote shootout; Raydium unproven
  but quote-only in happy path) > ds11-sol-lst-switch (mSOL→JitoSOL via
  Sanctum; Lane 2 venue UNPROVEN on the mirror — first take doubles as its
  phase-0 spike, Jupiter fallback noted in-file). ds10/ds11 share DS6's
  wallet biography (3.5 mSOL) so the takes cut together. All four compile.
  Standing rules apply: re-fork the mirror before shooting; verify env
  inside the live backend process before rolling.

2026-08-02 (later) — **CLEAN ds4 take delivered**: 66s at 2x, attempt 1, zero
  reverts, arrival 0 → 9.8505 ETH on Base, agent's own close: "The bridge
  landed. ✅ … matches the ~9.85 min-received floor after the Across relayer
  fee." Three content fixes got it there, each from a failed take:
  (1) across skill template fallback (product-mono
  crates/skills/manifests/evm/across/across.template.md): derive
  quote_timestamp/fill_deadline from SpokePool getCurrentTime() (wall clock
  reverts InvalidQuoteTimestamp/InvalidFillDeadline on forks) AND
  output_token = DESTINATION chain's WETH (agent reused the mainnet WETH
  address → unfillable deposit, filler correctly refused for lack of
  inventory); (2) recorder zeroes the wallet on non-source chains (anvil's
  10,000 ETH prefund made one honest agent say "fork-default state, can't
  tell if the fill landed"); (3) recorder resyncSimForks() — the demo
  backend NEVER starts per-instance refork/sync tasks (log has zero
  "Starting per-instance refork task" lines), so sims freeze at boot state;
  measured live: proxy 10 ETH vs sim 10,000 ETH; agent proposed bridging
  1,000 ETH (E2E cap correctly blocked it). Recorder now finds each sim by
  ps (anvil forking from our proxy) and anvil_reset's it post-seed; the
  interval stamping in up.rs is kept but insufficient alone — WHY the
  backend skips start_background in this mode is an open product question.
  ALSO DONE (task #9, was chip task_fe0fc8c8): custom-error decoding in
  product-mono crates/evm — gateway/error_decode.rs + generated
  known_error_selectors.rs (337 selectors from all crates/skills/abis via
  cast keccak), wired into cast_client eth_call errors, simulate.rs
  decode_revert_reason fallthrough, view.rs revert_reason; 46/46 aomi-evm
  tests, clippy/fmt clean. NOTE for commit: crates/skills/generated/* now
  mixes my across.md regen with the other workstream's marinade regen —
  regenerate on a clean tree at commit time.

2026-08-02 — **ds4-bridge-to-base RECORDED end-to-end** (demo/out/…/-2x.mp4,
  140s @2x, delivered). Agent chose Across, picked its own 0.05 ETH gas
  reserve, bridged 9.95; AcrossFiller executed real fillRelay on the Base
  fork (fill 0x8304d9…, journal `filled`); agent verified "+9.865 ETH
  credited" on Base ON CAMERA. Journal also shows strictness working:
  upstream deposits toward unforked chains rejected with reasons.
  Landed on the way (product-mono `chain-actor` branch, uncommitted):
  (1) OpDepositFinalizer — phase-2 canonical "mock sequencer" (`base-native`
  actor; agent's first takes chose L1StandardBridge depositETHTo, invisible
  to the Across filler; scenario now arms BOTH actors); (2) driver per-chain
  fault isolation + daemon tracing init (an OOM-killed Base proxy silently
  froze ALL scanning with an empty journal); (3) `test-env evm up` stamps
  sim instances with sync=5s/refork=15s (localhost upstream = free) — fixes
  agent READS seeing pre-seed state (thread titled "Approve 0.1 ETH
  Transfer" while the proxy held 10 ETH); (4) ActorCtx timeout 10s→120s;
  Widget recorder: 20s post-seed settle, deviceScaleFactor 2→1 (Chromium
  OOM), actors up/down per attempt, 7702 wipe, source-only funding,
  require-all-chains execution proof. Ops: account 8641fa7c… upgraded
  free→pro (500.9/500 exhausted mid-take → payment-required modal blocked
  the composer); machine survived OOM (Docker + other sessions' 10-anvil
  fleets + 4.9GB bloated next-server) and a 100% full disk (foundry rpc
  cache + failed-take webms). FOLLOW-UPS: agent falsely claimed "9.9 ETH
  arrived" in a NO-fill take (balance read through sim showed the 10k anvil
  prefund? investigate read path + consider zeroing dest-chain prefund at
  seeding); Base USDC whale 0x0B0A5886… holds 0 on current forks (swap
  WHALES entry); eval spec + across upstream-deposit noise fills journal on
  refork (cursor clamp interplay — benign, verify); demo stack left UP
  (forks 51521/51524, backend 8081, portal 3500) for more takes.

2026-08-02 01:15 — **PROOF TAKE PASSED on the rebuilt backend** (attempt 1,
  fresh Surfpool fork): SOL 10→0.008, USDC 25→391.09, mSOL 0→3.571, all
  chain-verified. All four agent fixes observed in behaviour: no invented
  amounts (closing line states no numbers it didn't read), one leg per turn,
  repair bounded (2 corrective re-stages then success, 45s turn), and the
  agent CREATED the mSOL ATA itself — no fixture. Root cause of the earlier
  fresh-rig failure confirmed as FORK STALENESS: a 7h-old mirror rejects
  live-quoted Jupiter routes in simulation; a minutes-old fork passes first
  try. RUNBOOK RULE: re-fork the mirror before any recording session.
  Note: `test-env svm down` tracked a wrong pid (killed a ghost, left the
  real 7h surfpool holding 8899) and `svm up`'s spawn path dies silently
  (empty logs) — fresh mirror was booted directly; worth a product-mono chip.
  Polish candidates, NOT blockers: closing message is a terse "Solana
  transaction confirmed." (rule over-corrected — should read balances and
  summarize from tool results); turn-4 trace shows two Failed simulate steps
  before success (honest, but a re-roll could get a cleaner hero take).
  Videos: demo/out/ds6-sol-swap-stake (133s master + 67s 2x).

2026-08-02 (session halted by Cecilia — read before resuming demo work) —
  Backend REBUILT with all four agent fixes (invented amounts, dependent-batch
  staging, unbounded repair loops, missing-ATA handling); binary + runtime
  skills bundle both verified to carry them. NO passing take on the new binary
  yet: the shared apps/portal/.env.local was repointed to port 8081 mid-session
  by a parallel session, so two recording runs died with the portal unable to
  reach the backend at all (browser showed prompts with no reply + HTTP 502).
  Demo backend moved to 8081 to match; portal→backend verified healed (502→400)
  but the re-run was stopped before completing. ds6 scenario now has NO mSOL
  fixture (removed to prove the post-#912 agent creates the ATA itself) — that
  claim is UNPROVEN. Rig left running: backend :8081 (providers-demo.toml,
  mirror pinned, real-mainnet fallback removed), portal :3500, surfpool :8899.
  EVM anvil forks are DOWN. ~180 GB freed (stale worktree build caches).
  Full handoff: this entry + demo/README.md failure-modes section.

2026-08-01 — **First Solana demo recorded** (`demo/out/ds6-sol-swap-stake`,
  86s master + 43s 2x). Jupiter swap 5 SOL → 365 USDC via HumidiFi, then
  Marinade stake of the rest → 3.57 mSOL, both confirmed on the Surfpool
  mainnet mirror and both proven from chain state, not UI text. This closes
  phases 2–3 of SOLANA-DEMO-PLAN.md; the plan is now fully executed.

  Getting there cost eight takes and surfaced four defects worth keeping:

  1. **`test-env svm reset` does not reset.** It does not restart Surfpool
     (up 3h57m across a dozen resets) and does not re-apply the airdrop or
     `token_fixtures`. Takes silently inherited the previous take's balances.
     Fixed: scenarios declare `svm.fund.sol` + `svm.tokenAccounts`, and the
     recorder writes both after every reset via `surfnet_setAccount` /
     `surfnet_setTokenAccount`. Assertions tightened to match.
  2. **The agent apologised for succeeding** — the same failure class as the
     chat.aomi.dev screenshot that started this work. Turn 2 fired 1.6s after
     turn 1 stopped streaming, before the execution callbacks landed, so the
     agent re-staged an executed leg and closed on "your current balance is
     ~0.0099 SOL … not enough" over a perfect swap and stake. Fixed: the
     recorder settles follow-up turns after EVERY turn, not just at the end.
  3. **Empty (`amount: "0"`) ATA fixtures hang the take.** The agent cannot
     distinguish an empty ATA from a missing one, tries to create it,
     `svm-manifest-guard` blocks it (backend predates #912), and it loops on
     "Correcting Marinade stake account" until timeout. Fixed with dust;
     removable once the demo backend is rebuilt past #912.
  4. **Joint simulation of both legs fails deterministically.** Every passing
     take simulated 8 txs; every hung take simulated 9. Asking for swap+stake
     in one sentence makes the agent batch them, and the stake cannot simulate
     against SOL the swap has not freed. Fixed by one leg per turn.

  Also: LLM bundle construction is non-deterministic, so `RECORD_ATTEMPTS`
  (default 3) re-seeds and re-shoots until a take passes and deletes failed
  attempts' videos — the shipped take passed on attempt 2. Camera hygiene now
  handled in-recorder: consent pre-declined, dev indicator off via
  `AOMI_HIDE_DEV_INDICATOR` (new opt-in flag in apps/portal/next.config.ts +
  the `portal-demo-studio` launch config, which was referenced in the README
  but did not exist), sidebar collapsed and *verified* collapsed.

  New scenarios authored, NOT yet recorded: `ds7-sol-yield-scan` (read-only
  venue comparison — the reasoning turn with nothing to fail, and the most
  reliable asset in the catalog) and `ds8-cross-vm` (Ethereum + Solana in one
  thread; the actual differentiator, and the one unproven thing is whether the
  agent holds both wallet identities across the VM boundary).

  Corrected `specs/DEMO-SCENARIOS.md` scenario 6, which claimed Solana
  "cannot run on a fork" and should be shot on mainnet with real money.

  OPEN, needs a decision: the agent's closing summary said "approximately
  4.85 mSOL" when the wallet actually received 3.57 — a wrong number, stated
  confidently, on camera. Chain state is right; the agent's arithmetic in the
  summary is not. Worth fixing before this take goes to a Solana-literate
  audience.

2026-08-01 — BUILT mock-relayer phase 1 (product-mono branch `chain-actor` off
  origin/main e3d9739ea, uncommitted). MY files: aomi/Cargo.toml+lock (member +
  workspace dep), crates/anvil/{Cargo.toml,src/lib.rs,src/evm/mod.rs,
  src/evm/actors/* NEW}, crates/actors/ NEW (AcrossFiller), bin/cli/{Cargo.toml,
  cli.rs,commands/test_env/{mod.rs,evm/mod.rs,actors.rs NEW}}, bin/eval/
  {Cargo.toml,spec/mod.rs,assertions/{mod,balance,event_log,state}.rs,
  run/{mod,preflight}.rs, specs/across/bridge_base_usdc_to_arbitrum_send_and_fill.json
  NEW}. WARNING: the same checkout carries ANOTHER session's uncommitted
  protocol-attribution work (crates/skills/guards/*, crates/evm/assemble.rs,
  crates/tools/*, crates/core/*, bin/backend, bin/cli/src/tests.rs) being
  edited live during mine — state.rs was a merge point (their `protocol: None`
  fix + my field restore). Cecilia must not commit the tree wholesale.
  Verified: aomi-anvil 64+10 tests (6 new actors), aomi-actors 10/10,
  aomi-eval 83/83, clippy/fmt clean; LIVE smoke (isolated forks 53101/53102,
  sandboxed $HOME): crafted depositV3 on eth fork → daemon filled via real
  Base SpokePool → +0.998 ETH native at recipient, journal filled, status
  renders; fill tx receipt shows FilledRelay + WETH pull + unwrap.
  DISCOVERY: anvil mnemonic accounts incl. demo wallet #2 have EIP-7702
  sweeper code on real mainnet+Base (0xef0100…) — bridge fills to them get
  swept in-tx; recorder must anvil_setCode(wallet,"0x") at funding time.
  Fixes en route: ActorCtx timeout 120s (cold-fork fills exceeded 10s and
  journaled as errors while landing), journal errors now carry {err:#} chain.
  PENDING: 42161 fork target in providers.toml (new eval spec fails fast on
  it, correctly); rewrite ds4-bridge-to-base to chains [1,8453] +
  actors ["across"] + setCode wipe + dest-chain verify; dest-chain ERC20
  token aliases in eval (custom aliases still pin to env chain — natives +
  event_log route today); phase 2+ adapters (OpDepositFinalizer, CctpAttester,
  ZeroXGaslessRelayer).

2026-08-01 — Designed the mock relayer: specs/MOCK-RELAYER.md (design only, no
  code; target repo product-mono). "Chain actors" — impersonated counterparties
  that watch a source fork and submit the REAL fill tx to the REAL destination
  contract on a destination fork: mechanism (trait + poll driver + JSONL
  journal) in aomi-anvil::evm::actors, protocol adapters in a new aomi-actors
  crate (phase 1 AcrossFiller, then OpDepositFinalizer, CctpAttester,
  ZeroXGaslessRelayer). Strictness contract: reject what a real relayer would
  reject; the certified claim is "the agent produced a deposit a correct
  relayer would have filled". Surfaces: `aomi test-env actors up/status/down`,
  demo Scenario gains `actors?: string[]` (unblocks ds4-bridge-to-base
  end-to-end on chains [1,8453] and dissolves the route-drift problem), and
  eval `run.environment.actors` in preflight (same provider_manager()) so
  EXISTING balance_delta/event_log assertions grade destination chains — the
  across/cctp/base_native eval specs currently stop at source-side assertions.
  Open: crate-vs-module, fill latency default (4s demo / 0s eval), 42161 fork
  for the Base→Arbitrum eval. PENDING: Cecilia reviews the spec before any
  code.

2026-08-01 — Renamed portal E2E executor `executeE2EWalletTransaction` →
  `executeE2EvmTransaction` (EVM-only; pairs with `executeE2ESolanaTransaction`).
  Touched: apps/portal/src/server/e2e-wallet.ts, e2e-wallet.test.ts,
  apps/portal/src/app/api/bff/e2e/execute/route.ts.

2026-07-31 — Fixed the browser POST /api/exec/simulate empty-body bug (on this
  branch, not committed). ROOT CAUSE (proven in real Chrome + undici): the
  portal's withDebugLogging rebuilt Request inputs via `new Request(url,
  request)` — the Request lands in the RequestInit position, so its buffered
  string body is read back as a ReadableStream (`duplex: "half"`). Chrome only
  sends streaming uploads over HTTP/2, so on plain-http localhost the fetch
  dies with ERR_ALPN_NEGOTIATION_FAILED, and under Playwright interception the
  streamed body reads as 0 bytes → backend 400 "EOF while parsing". The chain:
  simulateBatch → wrapFetchWithAccountBearer → paymentFetch (wraps string url
  + init into a Request) → withDebugLogging (mangled it). FIXES:
  apps/portal/src/lib/portal-client-options.ts — withDebugLogging now passes
  Request inputs through untouched (their URL is already absolute);
  applyLockedAppScope (same Request-as-init bug, latent) now rebuilds field by
  field with a buffered body and went async. packages/client/src/client.ts —
  wrapFetchWithAccountBearer clones Request inputs per attempt so the body
  survives the first send AND the 401 retry (was: retry re-sent a consumed
  Request); exported for tests. Tests: packages/client/test/
  client.fetch-wrapper.unit.test.ts (4) + apps/portal/src/lib/
  portal-client-options.test.ts (6, node env — jsdom mixes undici Request
  with its own AbortSignal). Verified in the main checkout before porting
  here: full client suite 289 green, portal lib tests green, eslint/tsc clean
  on touched files, real-Chrome A/B against an HTTP/1.1 echo server (buggy
  chain fails, fixed chain delivers the body intact). The demo rig's
  WORKAROUND stub for **/api/exec/simulate in demo/capture/record.ts was
  REMOVED with the fix in place — per the stub's own note, re-run a fork demo
  capture to confirm fee injection now works end-to-end (not yet re-tested;
  vitest cannot run inside .claude worktrees, so run tests from a regular
  checkout).
2026-08-01 (later) — Integrations page REDESIGN PORTED TO THE REAL PAGE
  (same worktree/branch, uncommitted). Design was iterated with Cecilia on
  /mock-integration, then moved wholesale:
  - `features/integrations/how-it-works.tsx` (NEW): TelegramHowItWorks —
    plain-text 4-step explainer (PT Serif heading) + BotFatherGuide, a
    Telegram-dark chat mimic of the real /setcommands exchange (hardcoded
    Telegram colors #0e1621/#182533/#2b5278 by design, BotFather header with
    verified badge, Copy chip on the command-list bubble).
  - `features/operate/bots-view.tsx` (REWRITTEN): provider rail (real brand
    marks: Telegram plane #2AABEE, Discord Clyde #5865F2, Slack 4-color;
    Discord/Slack greyed "Soon"; bot count pill; Add bot pill) → how-it-works
    → inline AddBotCard (token/label 13px labels over 12px hints, sliding
    ThreadModeToggle with `?` tooltip control top-right of the app table) →
    one card per bot (monogram, masked token `platform_bot_id:••••`, Active
    pill, thread-mode label, Change apps + circular trash, primary-starred
    app chips) with in-place edit (framed APP|SOURCE|PRIMARY table, checked
    rows accent-washed, radio primary, ghost rows uncheckable-only + save
    blocked, thread mode DISABLED with "can't be changed after registration
    yet" tooltip until the manager PATCH gains thread_mode). Data layer
    unchanged (react-query bots key, POST/PATCH/DELETE via
    API_PATHS.bff.operate.bots, cache updates). `embedded` prop dropped.
  - `features/integrations/integrations-view.tsx`: slimmed to page header +
    BotsView (old Telegram hero + Discord placeholder cards gone; sign-in
    gates live in BotsView).
  - `/mock-integration` is now a fixture HARNESS for the real page (pattern
    from dev-operate-preview): stubbed window.fetch serves github/status +
    operate/bots GET/POST/PATCH/DELETE from in-memory fixtures under
    QueryClientProvider + GitHubSessionProvider, plus a page-local
    light/dark ThemeSwitch. Full add/edit/remove flows work there without
    auth — verified live (edit → toggle app → Save → PATCH → chips update).
  - bots-view.test.tsx rewritten for the new UI (5 tests: sign-in gate,
    cards+masked token+count pill, add-flow gating, edit lock/cancel, ghost
    block/unblock).
  Verified: apps/build vitest 403/403 (63 files), type-check, eslint clean.
  HARNESSES GROUPED under /dev (per Cecilia): NEW index
  `app/dev/page.tsx` (dev-only, notFound in prod — portal convention) lists
  all fixture harnesses; `dev-operate-preview` → `/dev/operate-preview`,
  `mock-integration` → `/dev/integrations-preview` (git mv; internal
  router.replace paths updated); old URLs kept as redirect stubs. NOTE:
  a concurrent session extracted `features/integrations/thread-mode-control.tsx`
  and made BotFather commands thread-mode-aware (botfatherCommands(mode) with
  a mode selector in the explainer) — bots-view test rescoped to the edit
  panel's disabled toggle to coexist. Re-verified 403/403 after both.
  BE COMPAT REVIEW vs product-mono main (PRs #914 lifecycle + #915
  /sessions): manager bot endpoints rewrote github_app_bots.rs →
  endpoints/builder_bots/ but the WIRE CONTRACT is unchanged (same paths,
  bot_registration(s) keys, same field names) — FE fully compatible. New
  capabilities adopted: PATCH now takes optional `label`/`thread_mode`
  (omitted=unchanged, blank label clears), create REVIVES disabled
  same-owner bots, delete drops the Telegram webhook. Wired through:
  packages/deploy UpdateUserBotInput + updateUserBot body
  (label/thread_mode), BFF operateBotsUpdateRoute accepts+validates optional
  `threadMode` ("single"|"multi"), bots-view edit panel thread-mode toggle
  ENABLED (draftThreadMode, Cancel restores, Save PATCHes), harness stub
  applies threadMode. Label editing via PATCH is possible BE-side but has no
  UI yet (follow-up). Verified: apps/build 404/404, packages/deploy 128/128
  (root vitest needs --exclude override inside .claude worktrees),
  type-check + lint clean; live harness round trip single→multi green.

2026-08-01 — Integrations page (build-staging.aomi.dev/integrations) FE logic
  fixes + redesign kickoff (worktree vibrant-cerf-89d084, branch
  claude/page-redesign-bug-fixes-277017, uncommitted). Full-chain read done:
  IntegrationsView shell → embedded BotsView → BFF operate/bots →
  packages/deploy client → manager github_app_bots.rs → bin/telegram runtime.
  FE fixes in `apps/build/src/features/operate/bots-view.tsx`:
  - Cancel button for edit mode (was a one-way door — editingId only cleared
    by successful save).
  - Thread mode select now disabled while editing, with explanatory hint
    (PATCH carries only app mappings; manager UpdateBuilderBotRequest has no
    thread_mode — the enabled select silently discarded changes).
  - Ghost apps (bot mappings no longer in the builder's sources) render as
    uncheckable-only rows under "No longer available", appear in the Primary
    select, and block save with an inline message instead of an opaque BFF
    403 "selected apps are not owned by this user".
  - Removing the bot being edited exits edit mode.
  - toggleApplication no longer calls setState inside another setState
    updater (StrictMode impurity).
  - "Attached apps" group is a div, not a <label> (nested labels gave every
    checkbox the same accessible name and any click in the box toggled the
    first checkbox).
  Tests: bots-view.test.tsx +2 (edit-mode lock/cancel, ghost-block); apps/
  build suite 403/403, type-check + eslint clean. NOTE: fresh worktree needed
  `pnpm install` + `pnpm --filter @aomi-labs/smither build` (dist JS is
  untracked; its tsup DTS step fails but emits JS first — the two committed
  dist .d.ts get deleted by the build, restore with git checkout).
  NEW blank design playground `apps/build/src/app/mock-integration/page.tsx`
  at localhost:3010/mock-integration (launch.json entry
  `build-mock-integration`, NEXT_DIST_DIR=.next-mock-integration; tsconfig
  include gained the matching two type globs, same pattern as .next-b/
  .next-verify). Page is deliberately empty — redesign direction TBD with
  Cecilia.
  KNOWN BE bugs deliberately NOT touched this session (FE-only scope):
  (1) removed (disabled) bot can never be re-registered — create's
  find_by_platform_bot ignores disabled rows + DB UNIQUE
  (platform, platform_bot_id) → permanent 409; fix = revive-on-create for
  same-owner disabled rows; (2) disable never calls Telegram deleteWebhook;
  (3) thread_mode/label not updatable via PATCH (manager + BFF + client).
  Dead FE stub also left in place: features/integrations/client.ts +
  server/bff/integrations/routes.ts (status always disconnected, connect
  501) — wired to /api/bff/integrations but nothing calls it.

2026-07-30 — Operate batch reads for the REST of the herd: transactions,
  statement, usage, logs (branch `fix/operate-batch-reads` in aomi,
  `feat/operate-batch-reads` in product-mono). Cecilia reported Transactions
  and Usage still showing "0 of 111 — pick a single source" with Usage then
  presenting the Example-data statement; teammates with real transactions
  could not see them. MEASURED: per-source statement reads are ~1s solo but
  ~5–6s each at the BFF's exact 6-wide fan-out (~1 source/sec throughput) —
  111 sources can never fit the 20s budget, so both fan-out legs mass-drop.
  MANAGER (product-mono): four new service routes under
  /api/integrations/github-app/user/ — transactions + logs return ONE
  globally-merged newest-first page (global tuple cursor; pagination got
  simpler), statement + usage return per-source results arrays in the exact
  single-source wire shapes. Shared endpoints/batch_scope.rs resolves every
  owned source under its own bound/loaded platform (observability batch
  refactored onto it); statement buckets/usage/logs SQL batched via
  unnest-pairs joins (EXPLAIN-validated read-only against the live DB before
  deploy); partner-payment ledgers only for sources WITH apps, in waves of 8.
  Shared partner-settlement log rows carry NULL app_source_id (account-level).
  AOMI: deploy client listUserTransactions/getUserStatements/getUserUsage/
  listUserLogs; BFF routes batch-first (batch caches, 15s), 404 → legacy
  fan-out fallback, single-source (?appSourceId=) stays on per-source reads
  (also fixed: observability batch now narrows to the picked source).
  UX per Cecilia ("the old way is better"): DegradedNotice banner REMOVED
  everywhere, `degraded` off the wire; a fallback losing EVERY read now 503s
  ("Operate reads are temporarily unavailable") → FE red error state instead
  of empty-page-plus-banner or Example data. exampleStatement remains ONLY
  for genuinely available:false statements (BE-not-migrated), never for
  failures. Composite cursor gained a `batch` slot ({batch: {...}} on the
  wire, opaque to the FE).
  Verified: manager cargo test 137+manifest, clippy/fmt clean; worker
  node --test green (route added to MANAGER_ROUTE_PATTERNS + test); aomi
  vitest 1154 passed, tsc + lint clean. DEPLOY ORDER: product-mono first
  (backend auto-deploys on merge; worker needs MANUAL
  `wrangler deploy --env staging` with Han's CLOUDFLARE_ACCOUNT_ID), verify
  via probe, then merge aomi. FOLLOW-UPS: prod worker deploy with the next
  prod backend release; delete settleBySource + per-source fallback once
  batch soaks; consider caching partner-payment reports (still the slowest
  leg of statement/observability batches).

2026-08-03 — Portal Account tab UI restyle **merged** (PR #431 → `main`).
  Account settings now matches `aomi-portal` mock: custody-grouped wallet rows
  with provider logos (`wallet-brands.tsx`), inline grant status, radio signing
  modes (`SigningModeList`), grant revoke inside expanded rows, attention strip,
  unbound wallets → Activate (bind), Para agent provision strip, flat Revoke all.
  Live API wiring unchanged (`use-account-acl.ts`). New helpers:
  `account-reconcile.ts`, `wallet-policy-row.tsx`. Follow-ups (not blockers):
  `rdns` on API for self-custody wallet logos; deterministic re-grant route.

  `account-reconcile.ts`, `wallet-policy-row.tsx`. Docs:
  `docs/SETTINGS-REDESIGN-GAPS.md` updated. Still open: `rdns` on API for
  self-custody wallet logos (Para/Privy always show). Rebased onto main;
  preview QA on Vercel before merge.
2026-08-03 (later) — ROOT CAUSE + FIX: browser SSE was silently dead in the portal
  (every session, every event type, predating the orchestrator work).
  packages/client/src/sse.ts built the stream URL with `new URL(`${backendUrl}/api/
  thread/updates`)`; the portal's getBackendUrl() returns "" (same-origin BFF), and
  a base-less relative `new URL("/api/…")` THROWS before fetch — the subscriber's
  retry loop swallowed it forever, so zero /api/thread/updates requests ever left
  the browser (portal log evidence: 247 state polls, 0 SSE connects during an
  orchestrator run). Nobody noticed because polling covers messages; task_* events
  are the first SSE-only user-visible feature. Fix: relative-safe string URL (like
  buildApiUrl) in sse.ts + regression test test/sse-url.unit.test.ts; client+react
  dists rebuilt; portal restarted with fresh .next. Verified: bus replay of the
  affected thread shows task_started + 5 task_activity flowing through the portal
  proxy. Also: backend emission confirmed working from the user's actual run (child
  thread spawned, label "1 wei self-transfer"). Remaining perceived slowness is the
  known local GPT-5.5 pipeline latency (12-16s/call through cliproxy, serial).

2026-08-03 — Orchestrator UI §5 (+§1) landed in apps/shadcn-registry — the trace UI.
  New `WorkingAgent` (components/assistant-ui/working-agent.tsx): one delegation as a
  row — pulsing identity dot (accent → pink by order of appearance) that becomes a
  check/X on terminal status, mono label, summary slot (hidden while live+expanded,
  shimmering latest intent while live+collapsed, the child's `message` when done),
  live "N steps · Xs" counter (1s tick), chevron; children stream under the
  `ml-[7px] pl-[17px] border-l` rail (tool calls through the existing interpreter,
  notes as WorkingNote, both with the same expandable `<pre>` detail). Mounts
  expanded while live, auto-folds ~900ms after completion unless the reader toggled
  it. Row primitives shared with the mother trace were factored into
  working-trace-rows.tsx (ToolStepRow / WorkingNote / ToolChipView) to avoid an
  import cycle. working-trace.tsx joins transcript ↔ sidecar: `readTaskPartAgentId`
  parts render as agent rows, live runs with no part yet render as synthetic rows
  keyed by agent id (sticky until the part lands, so the row never blinks), header
  says "Orchestrating"/"Orchestrated for X" + `aui-working-badge` when the TURN has
  task rows (not the selected app), step count = rows + child steps, and agent rows
  are exempt from the staggered-reveal backlog. Interpreter: new `task` family
  (title "Delegated: <label>", Bot icon, short-agent-hash + `staged N` chips, failed
  when status ≠ completed) via optional `title`/`failed` overrides on ToolOperation.
  App selector: `orchestrator` app-metadata entry (Orchestrator/Or, new "Modes"
  category, order 5) + pinned two-line row under "Basic Apps" in AppSelect.
  Tests: working-agent.test.tsx (7), 3 interpreter cases, orchestrator app-metadata
  + 2 AppSelect cases. Pending: product-mono event emission (§2) — until it ships
  the UI renders the Phase-0 done-state row from the transcript alone.

2026-08-03 — Orchestrator UI §3+§4 landed (client + React runtime; UI still pending).
  packages/client: AomiMessage now models `tool_name`/`tool_arguments`; new
  `AomiTaskEvent` union (task_started | task_activity | task_completed) +
  `parseAomiTaskEvent` guard in src/types.ts; SessionEventMap gained the three
  events; session/events.ts re-emits them like tool_update (no session-state
  mutation); CLI verbose narration (`◆ [agent] … started`, `  ↳ step`,
  `  ✔ label: status (N steps, Xs)`) in cli/output.ts + commands/chat.ts.
  packages/react: `TaskRunState`/`TaskRunStep` + pure `reduceTaskRuns` reducer and a
  per-thread `taskRuns` map in state/thread-store.ts (dedupe on (agentId, childSeq),
  idempotent SSE replay, out-of-order tolerant, client-clock startedAt);
  ThreadContext gained allThreadTaskRuns/getThreadTaskRuns/applyTaskEvent/
  clearThreadTaskRuns plus `useThreadTaskRuns` / `useTaskRun`; runtime/orchestrator.ts
  subscribes to the three events next to forwardEvent("tool_update") and reduces
  into the sidecar; toInboundMessage now prefers `tool_name`, passes
  `tool_arguments` as args, and attaches `metadata.custom.aomiTask = { agentId }` to
  completed `task` tool-call parts (survives mergeAssistantTurns re-keying and
  fromThreadMessageLike). Tests: reducer/store unit tests, runtime wiring test,
  projection + merge metadata tests, client SSE routing + CLI line tests.
  Pending: apps/shadcn-registry WorkingAgent UI + task interpreter family + app
  selector entry (§1/§5), and the product-mono event emission (§2).

2026-08-03 — Orchestrator UI: plan written (specs/ORCHESTRATOR-UI-PLAN.md), no code
  yet. Decided UX (animated mocks:
  https://claude.ai/code/artifact/96148a25-4320-4138-928e-ed4a395c3e35): agent row
  per delegation inside aui-working-trace, auto-expands while live / auto-folds to a
  one-line summary on completion unless user-toggled; vertical rail under each agent
  row is a MUST-KEEP; header shows "Orchestrating" + orchestrator badge. Entry =
  selecting the `orchestrator` app in the existing AppSelect (backend already gates
  `task` on app id; needs descriptor exposure + app-metadata entry + pinned "Modes"
  row). Protocol decision: backend emits task_started / task_activity / task_completed
  on the MOTHER's event bus from ChildTaskService::drive() (parent SSE endpoint and
  child 409 gates unchanged). Today NOTHING of a child is visible to any UI — parent
  transcript gets one redacted `task` result post-hoc; TS AomiMessage doesn't even
  model tool_name/tool_arguments (Rust serializes them). Phases: 0 = transcript-only
  done-state rows (no backend change), 1 = lifecycle events, 2 = child activity
  streaming (full UX), 3 = failure states + parallel children. Pending: product-mono
  event emission; packages/client types + SessionEventMap; taskRuns sidecar in
  thread-store + orchestrator.ts reducer; WorkingAgent component; task interpreter
  family; open questions in the spec (app gating tier, activity payload truncation,
  stall UX, note granularity).

2026-07-30 — Observability batch read: fan-out removed at the source (branch
  `feat/operate-batch-observability` in BOTH repos; aomi PR #426, product-mono
  PR #901; based on main incl. #423 + #424).
  ROOT CAUSE (measured on staging via a minted service bearer, 113 sources):
  one per-source observability read = ~1.9s (~9 Grafana HTTP queries); at the
  BFF's 6-wide fan-out reads stretch to 6.1–8.6s because Grafana serializes
  the ~54 concurrent queries — every read outlives #423's 8s per-source
  timeout, so /operate/observability rendered "Showing 0 of 113 sources".
  Also: partner-bound sources (somm.finance) 404 "not launch-relevant" under
  the default platform on every unscoped page load — permanently counted in
  the degraded banner. Probe recipe + full facts in auto-memory
  (observability-fanout-root-cause).
  MANAGER (product-mono #901): new service route
  GET /api/integrations/github-app/user/observability?github_user_id=
  [&platform=] → { results: [single-source wire shape] }. One
  Grafana/rollup snapshot per PLATFORM (operate_monitoring generalized to a
  source-id set; transaction_metrics_24h_for_sources ANY($1)); each source
  resolved under its own bound/loaded platform (fixes partner 404s);
  partner-payment ledgers in bounded waves of 8; single-source read's
  sequential per-app current_sdk_version N+1 replaced with batched
  current_sdk_versions; app_health_json/dashboard_links_json shared between
  single + batch so shapes can't drift.
  AOMI (#426): packages/deploy getUserObservability(); BFF
  operateObservabilityRoute does ONE batch read (15s TimedPromiseCache).
  404 (pre-batch manager, mid-rollout) → falls back to the #423 bounded
  per-source fan-out; other errors surface. degraded unset on batch path.
  FE untouched (same response shape).
  DEPLOY ORDER: either PR lands first (fallback covers the gap); page gets
  fast only once the manager deploys. FOLLOW-UPS once staging verifies:
  delete the per-source fallback + settleBySource for observability; apply
  the same batch pattern to transactions/usage/logs/statement (same herd);
  then re-check the "0 of N" banner never fires.
  Verified: manager cargo test 137+manifest, clippy/fmt clean, backend check
  green; aomi 497/497 (apps/build + packages/deploy), type-check + lint clean.

2026-07-29 — Build project-page perf: react-query ownership + parallel reads
  (worktree untitled-session-7921bd, uncommitted; based on main 0e89ece2).
  Diagnosis: /projects/:id was the last page outside react-query — hand-rolled
  fetch of ALL sources per mount, first paint gated on `Promise.all(sources,
  sdkStatus)`, no prefetch entry, then a strict depth-2 waterfall for HomeTab's
  secrets+usage. Changes (apps/build):
  - `use-project-detail.ts`: source/sdk/loading/error now `useQuery`-owned.
    Source list keyed by NEW `buildQueryKeys.projectSources(account, platform)`
    — identical to the `projects` key when unbound (shares the /projects index
    cache + hover prefetch; nav list→project reads cache), platform-scoped for
    bound projects (1620/somm.finance would `.find()` nothing in the unbound
    list). sdkStatus is its own query and NO LONGER gates first paint (badge
    fills in; `sdkCompatibility(_, null)`="unknown" so nothing flashes).
    `reload()` → `refetchQueries`; records-latch reset preserved on
    [sourceId, platform] change. Hook also returns `accountKey`.
  - `prefetch-control-plane-route.ts`: NEW `prefetchProjectDetail()` (sources +
    sdk + usage) + a /projects/:id matcher case — hover now warms the detail
    page; ProjectPage calls the same helper on mount so cold loads run all
    reads in parallel; ProjectPage also fires `loadSecrets()` for home/env tabs
    at mount instead of after the source read.
  - `home-tab.tsx`: usage peek moved from useState/useEffect onto `useQuery`
    with the operate usage key (shared with /operate/usage + prefetch).
  - `server/bff/launch/routes.ts`: `timedManagerRead()` logs around
    `list_user_sources` + `server_tags` — read off one staging load to decide
    whether the manager needs a single-source/filtered read (fix #4).
  Behavior deltas: manual refresh no longer shows the full-tab spinner when
  data exists (SWR semantics via isPending); cold DIRECT loads wait for the
  GitHub session before the source read (cache key needs accountKey).
  Second pass (same session) — the two items first skipped, now done properly:
  - BFF launch read cache WITH mutation invalidation (`launch/routes.ts`):
    `readCache.{sources,serverTags}` (TimedPromiseCache, 15s) behind
    userSourcesRoute + launchSdkStatusRoute; unlike operate's read-only cache,
    every source-mutating route clears it via exported `clearLaunchReadCache()`
    — deploy/preflight factory, create-repo, activate, promote, deactivate,
    redeploy, and sourceSdkUpgradeRoute (source-upgrade.ts). This is what makes
    the cache safe for the redeploy→reload() flow (preflight registers apps;
    the next sources read must see them). timedManagerRead sits INSIDE the
    cache loader, so timing logs now measure only real manager calls.
  - Single-source read WITHOUT losing cache sharing: `?appSourceId=` on the
    sources BFF route filters BFF-side off the cached list (manager has no
    single-source endpoint; manager URL unchanged). Client chain:
    `API_PATHS...sources(platform, appSourceId)` → `deploymentSources(platform,
    appSourceId)`. Hook now queries `buildQueryKeys.projectSource(account,
    sourceId, platform)` (nested under the projects prefix) with
    `initialData`/`initialDataUpdatedAt` seeded from the `projects` LIST cache
    — warm list→project nav paints from cache with zero fetch while the list
    is fresh; cold loads transfer ONE source instead of the whole account.
    `projectSources` key helper replaced by `projectSource`; prefetch warms the
    slim read.
  Tests: use-project-detail.test.ts + home-tab.test.tsx + project-page.test.tsx
  gained QueryClientProvider/GitHubSessionProvider harnesses (pattern from
  use-projects.test.ts); user-sources.test.ts +3 (appSourceId filter + no
  manager leak, malformed→400, cache coalesce + clear seam; afterEach clears
  the module-level cache). Verified: aomi-build type-check, eslint, prettier,
  full suite 353/353. NOTE for worktree sessions: vitest excludes
  `**/.claude/**` so running tests INSIDE a .claude worktree needs a throwaway
  config that drops that exclude + cwd at worktree root; `@aomi-labs/widget-lib`
  = apps/shadcn-registry and needs `pnpm run build:package` THERE (root
  build:lib builds packages/react, not it); root build:lib also dirties
  committed packages/client/dist maps — revert those.
  Related: PR #423 (unmerged) bounds the operate settleBySource fan-out
  (6-way cap / 8s per-source / 20s budget) — covers /operate/observability;
  nothing here overlaps it.

2026-07-27 — Light/dark token sweep. Dark mode was losing all structure: in
  `themes/default.css` the dark block collapsed `--aomi-surface-2`, `--aomi-raised`
  and `--aomi-border` onto a single `#27272a`, so every hairline drawn on a panel
  was the panel's own colour — settings-modal dividers, table rules, the credits
  meter track and the round close button all rendered at 1.00:1. `apps/build`'s
  `aomi-design-tokens.css` had the identical collision on `cool-800`.

  Dark ramp re-laid as six distinct steps (bg `#09090b` → surface `#18181b` →
  raised `#202024` → surface-2 `#2e2e33` → hover `#4a4a52`, border `#3f3f46`
  clearing all of them); `--aomi-accent-subtle` became a sky tint (`#28354a`)
  so the selected nav row reads. Light had its own collision — `--aomi-hover`
  *was* `--aomi-surface-2` (`#f4f4f5`), so surface-2-filled controls had no
  hover at all; moved to `#e9e9ec`. `--aomi-success` split per theme (`#1f8558`
  light / `#35b37b` dark) — it renders as text and was 3.38:1 on white.
  `apps/build` got the same treatment via new `cool-150/650/750/850` stops, plus
  a duplicate `--aomi-ring` declaration removed from *both* its blocks (a later
  grey redeclaration was silently overriding the intended sky focus ring).

  Two cascade fixes in `themes/default.css`: `.dark` now re-declares the derived
  tokens (`--aomi-ring`, `--aomi-accent-tint`, `--aomi-accent-outline`,
  `--aomi-overlay-border`) — a `var()` inside a custom property substitutes
  against the *declaring* element, so they only re-derived because `.dark` lands
  on `<html>`, and broke under any subtree `.dark`; and `:root` is now
  `:root, .light` so light can be scoped to a subtree too (dark was a one-way
  door — relevant for embedding the widget in a dark host).

  Harness: NEW dev-only `apps/portal/src/app/dev/theme-audit/` renders the ramp
  and every redesigned surface twice (light + dark) from `features/usage/fixture.ts`
  — no account needed — and measures 21 contrast pairs by compositing on a canvas
  (Chrome serialises `color-mix()` as `color(srgb …)`, whose 0–1 channels an
  rgb() parser misreads). 9 hard failures → 4, all light-mode and deliberate:
  white-on-white `raised over bg` (the modal sits on a `black/50` scrim),
  `surface on raised` (surface is the recessed tone, as in light), and two
  unresolved below.

  PENDING (design calls, deliberately not made): `--aomi-accent` as text is
  3.71:1 in light — below AA — for "View full statement →" and tx links; the
  existing `--aomi-accent-strong` measures 5.30:1, so either darken the light
  accent or route text through a new `--aomi-accent-text`. `--aomi-warning`
  (2.48:1 light) is referenced by zero call sites — dead token, fix or delete.
  Also noted: `apps/landing/public/r/*.json` mirrors are broadly stale (11 files,
  predating the whole `aomi-*` token system) — `vercel-build` regenerates them
  from source at deploy, so they were left alone rather than hand-synced.

2026-07-26 (later) — Fixtures solved: Packages + Usage wired to live data
  (branch `worktree-settings-redesign`; backend twin in product-mono worktree
  `account-acl-be`, uncommitted).

  **Packages** — catalog from `GET /api/account/apps`, installed set from the
  profile's `user.apps`, install/remove via a NEW backend
  `PUT /api/account/apps` (full-replace of `users.applications`; names
  validated against the account's own visible catalog; `default` pinned).
  FE: `components/shell/packages-api.ts` + rewired `packages-modal.tsx`
  (brand decoration is now a `DECOR` lookup keyed by app name — real rows,
  decorated when known, monogram under "More" otherwise). Not optimistic.

  **Usage/statement (model subject)** — NEW backend
  `GET /api/account/statement?from_date&to_date`:
  `DbLlmUsageEvent::get_model_usage` (per app × model × payment_method over
  `llm_usage_events` — the daily rollup drops the model column, so this reads
  events; attribution mirrors `get_ranged_usage`, partner-fee rows excluded;
  DB-proven by `model_usage_groups_per_model_and_scopes_to_the_user`) +
  `aomi_account::model_statement` (statement assembly lives in the shared
  crate per the account extraction). USD via `AomiCredit::to_usd` — no FE
  pricing constant.
  FE: `features/usage/statement-api.ts` (wire→`MonthlyStatement` adapter),
  `use-usage-statement.ts` (per-month fetch + cache, allowance from the
  profile's embedded UsageStats), rewired `usage-settings.tsx` and
  `statement-view.tsx` (real identity header, real month picker).
  HONESTY RULE: tool/outcome subjects have no ledger writer (statement_entries
  declares them, x402 client unbuilt) — they render "—"/absent, never $0.00;
  allowance meter only for the current month. `fixture.ts` unreferenced, kept
  as the design harness for the unreal sections.

  Verification: portal tsc clean, 295/295 vitest, eslint clean on touched
  files, `next build` green. Backend: `cargo check -p backend` green, route
  manifest 10/10, entities 44/44 (DATABASE_URL → local supabase :54322),
  aomi-account 4/4, fmt applied.

2026-07-26 — Zombie sweep of `apps/portal/src/app` after the FE revamp
  (branch `worktree-settings-redesign`). Traced reachability of every page
  (by navigation) and API route (by fetch-path across portal/build/landing/
  packages/client/shadcn-registry). Deleted, portal type-check green:
  - `app/device-auth-complete/page.tsx` — orphan success page, zero refs
    (the device-auth flow redirects back to the CLI loopback, never here).
  - `app/auth/privy/signer-grants.ts` + its test — `ensureServerSignerAccess`
    imported only by its own test; emptied `app/auth/` entirely.
  - `app/blog/{page.tsx,[slug]/page.tsx,content.ts}` + the now-orphaned
    `BlogEntry` interface in `lib/utils.ts` — nothing linked `/blog`; both
    entries' CTAs point out to Notion.
  KEPT (Cecilia's explicit call) — the `/device-auth` + `api/aomi/device-auth/*`
  + `lib/device-auth-grants.ts` cluster is NOT a zombie: it backs the live
  `aomi account login` (Privy/Para) and `aomi account link --provider` CLI
  commands (`packages/client/src/cli/commands/account.ts` →
  `cli/device-auth.ts`). The old "accidental device-login" note referred to a
  different, already-removed apps/base RFC-8628 flow. Also verified live and
  left intact: the MCP cluster (`api/mcp` + `.well-known/oauth-*` +
  `/mcp/connect`, wired via better-auth's `loginPage`/`consentPage`), the
  `launch/*`↔`deployments/*` BFF split (both used by `features/launch/client`),
  `/dev/widget-auth-e2e` (dev-only, `notFound()` in prod), and the `/settings`
  redirect stub.

2026-07-26 — Account tab wired to the real ACL endpoints (branch
  `worktree-settings-redesign`). The tab was the last redesign surface running
  on fixtures; it now reads and writes live state. New files, all under
  `apps/portal/src/features/account/`:

  - `account-api.ts` — wire types + mappers for canonical `GET /api/account`
    ownership, policy, and capability collections, plus
    `DELETE /api/account/providers/:provider/grant`. `linkedVia` is derived,
    not stored: `wallet_provider` privy/para, else siwe/siws by chain. Legacy
    `human_sync`/`agent_sync` wire values normalize to the renamed modes.
  - `use-account-acl.ts` — the permit ceremony. `challenge` → `signTypedData`
    (EVM) / `signSolanaMessage` (SVM, which also names its `signer` since
    Ed25519 has no recovery) → `commit` → refetch.
  - `account-acl.test.tsx` — route-caller + ceremony coverage (4 tests).

  `account-signing.tsx` kept its design verbatim but is now controlled: no
  local mutation, per-row busy/error, and **nothing optimistic** — a mode flips
  only on the committed backend value, so a rejected signature or a failed
  version CAS can never look applied. Mode availability now follows backend
  truth (`SigningPolicy` plus current `DelegatedAccount` capability) instead of
  storing a second auto-availability boolean.
  Direction (loosen vs tighten) is pre-computed client-side against the
  kernel's rank ladder purely to explain "connect this wallet itself" before
  the prompt — the backend still decides. The posture strip counts only
  *active* grants; the grants list carries revoked/expired history.

  Backend side of this (endpoints, Para Auto, the Privy-revocation fix) lives
  in product-mono worktree `account-acl-be`, uncommitted.

  Verification: portal type-check clean, 290/290 tests pass, eslint clean.
  Still open (docs/SETTINGS-REDESIGN-GAPS.md): "Re-grant" routes through
  `openAccountUI` because no server-side re-grant exists; wallet brand tags
  need `rdns` captured at connect; Usage tab still on fixtures.

2026-07-26 — Design-system pass over the redesigned surfaces, driven by a
  component inventory review (branch `worktree-settings-redesign`). The
  aomi-* set is now the single vocabulary AND has explicit rules behind it:

  New tokens (all in the shared widget theme, apps/shadcn-registry/src/themes/default.css):
  - `--aomi-ring` + a `:where(...):focus-visible` rule so no surface falls
    back to the browser's default outline. Zero specificity, so components
    can still override.
  - `--aomi-accent-tint` / `--aomi-accent-outline` / `--aomi-overlay-border`
    replace 15 ad-hoc `/10` `/40` `/50` `/30` opacities in component code.
  - `--aomi-danger-strong` + `--aomi-on-danger` for destructive fills
    (white on plain `danger` is 4.3:1 — fails AA at 13px; strong is 5.6:1),
    plus a dark-mode lift for `danger`, which had none.
  - `--aomi-hover` retuned: was `#e4e4e7` (the border value, too heavy on a
    white menu) and `#27272a` in dark — byte-identical to `--aomi-raised`,
    so menu hover could never show. Now `#f4f4f5` / `#3f3f46`.

  Rules now encoded across the components:
  - Selection splits by SIZE, not by component: pill-sized controls take the
    solid accent fill (segments, filter chips); card/row-sized selection takes
    `accent-subtle` + accent icon (mode cards, nav rows, menu rows, modal rows).
    Neutral grey no longer means "chosen" anywhere.
  - Type ladder: badge 10px, chip/segment/search 12px, composer/button 13px.
  - Buttons are two shape families: pills at page level (ink commit + neutral
    dismiss + red destructive), rounded-lg in flow (blue commit + blue repair).
    All 34px, filled variants carry `border-transparent` so they match the
    outlined ones. The last accent gradient is gone.
  - Dismissal: every X is a circle — 32px on `surface-2` closes a surface,
    20px transparent-until-hover clears a field.
  - Menus: inset rounded rows (`rounded-lg` inside a 4px-padded panel), 32px
    tall, 12px, never full-bleed bands.
  - Modal shell: 50% flat ink scrim (no blur), `bg-aomi-raised` panel at
    `rounded-2xl`, no shadow/ring, 32px circular close, fixed header/footer
    with only the body scrolling. Two widths: 420px and 900x600.

  Files touched: portal — settings-modal, packages-modal, header-controls
  (rebuilt to mirror the mock: 32px rounded-lg icon buttons + sliding theme
  switch), general-settings, account-signing, statement-view, usage-shared.
  Registry — wallet-picker shell adopted the modal standard; thread.tsx
  composer field to 13px; thread-list + threadlist-sidebar finished off
  shadcn vocabulary. Mock (~/Code/aomi-chat-design) — chat-header theme
  switch scaled to the 32px baseline, composer scaled down.

  Verification: portal `pnpm run type-check` and registry `tsc` both clean
  after every step; specimen geometry checked as computed values in the
  browser rather than by reading class names.

  NOTE: another Claude session was working in this same worktree concurrently
  (registry conversation restyle). The token promotion below was theirs.

  Also this session: the inventory page's own theme control was replaced with
  the design system's sliding switch (it had been a one-off icon button), and
  apps/build was aligned onto the canonical `aomi-*` names — see
  docs/SETTINGS-REDESIGN-GAPS.md for what was additive vs left as an open
  human call (`--aomi-surface` means cool-0 there, cool-50 in the widget).

2026-07-25 (night) — Chat-surface restyle to the aomi-chat-design mock +
  portal glue cleanup (branch `worktree-settings-redesign`). The whole
  chat column now matches the mock, not just settings:
  (1) `--aomi-*` tokens PROMOTED into the shared widget theme
  (apps/shadcn-registry/src/themes/default.css — light + .dark + @theme
  utilities); the portal globals.css duplicate block deleted (portal keeps
  only its --font-display mapping). Every widget consumer now resolves
  the tokens; the shimmer + trace edge-fade CSS prefers aomi vars with
  shadcn fallback.
  (2) Conversation restyle in the registry (all behavior kept): thread.tsx —
  mock empty state (centered AomiMark + "What can I help you onchain?" +
  hero composer + pill suggestion chips; dock composer "Reply to Aomi…"
  only when a conversation exists), user bubble = surface-2
  rounded-2xl/rounded-br-md 15px, assistant rows carry a 26px AomiMark
  avatar, small muted copy/rerun action bar; working-trace.tsx = bordered
  card (surface header "Worked for Ns · N steps" + green check, mono step
  titles, rounded-full surface-2 chips) — reveal cascade, windowing,
  scroll fades, auto-collapse all unchanged. New shared
  components/aomi-mark.tsx (threadlist-sidebar now imports it).
  (3) Chrome: frame header = mock geometry (h-14 border-b, thread title
  left); portal HeaderControls gained the real NetworkSelect styled as
  the header pill (composer hides network via hideNetwork; NetworkSelect
  now exported from widget-lib); sidebar footer DualWalletBar restyled as
  the mock account chip (avatar + two-line address/network + chevrons).
  (4) Portal glue cleanup: ONE shared /api/account store
  (lib/account-overview.ts, seeded by the session probe — was fetched 3×
  per settings open; copy-pasted AccountProfile types gone; dead
  AomiSessionProvider removed); portal-aomi-frame.tsx 415→155 lines
  (fetch middleware stack extracted to lib/portal-client-options.ts);
  `pnpm --filter portal test` NOW RUNS THE REAL 45-file vitest suite
  (was a no-op script exiting 0 — scripts/run-tests.mjs deleted, stale
  usage-range exclude dropped); fixed 3 silently-broken tests (2 launch
  routes tests stale vs deploy's fail-closed required-secrets policy —
  ported apps/build's versions; svm-wallet-binding test missing the
  svmTransport:"embedded" gate); /statement can scroll (h-screen +
  overflow-y-auto under the overflow-hidden root layout); settings gate
  on probe ERROR now only blocks General — Account/Usage render their
  fixtures behind a slim retry banner (anonymous/establishing still gate
  fully).
  Verified: portal 45 files/286 tests, registry 39/280 (after
  widget-lib build), react 12/126, repo lint + root/portal typechecks all
  green; live at :3400 vs the mock at :3010 in light + dark (empty state,
  header pill, packages, settings modal, /statement scroll). Conversation
  visuals (trace card, bubbles) verified by tests; live-chat check needs
  the local backend. NOTE: gaps doc lives at repo-root
  docs/SETTINGS-REDESIGN-GAPS.md.

2026-07-25 — Settings redesign port (branch `worktree-settings-redesign`,
  `apps/portal`): settings surface reduced to three tabs — General /
  Account / Usage — per the aomi-chat-design mock, styled to the aomi
  design system (sky accent + pink decorative meters via new `--aomi-*`
  tokens in globals.css, PT Serif display font, flat/no shadows).
  New: `features/account` (wallet signing ACL editor — posture grid,
  custody-grouped wallet cards, Manual/Accept transactions/Auto/Locked
  modes, delegated-grants panel; wallets/grants are FIXTURES),
  `features/usage` (three-subject summary + by-app matrix) and a
  standalone `/statement` route (month picker, By app/Itemized views,
  app+subject filters; 3-month FIXTURE statement). GeneralSettings
  reworked (identity card + Manage account → Account tab, Theme wired to
  useSettings.colorMode, network/wallet rows). Removed: Deploy, App Keys,
  Bots, Secrets, BYOK tabs (+ features/{apps,app-keys,bots,secrets,byok},
  deploy-settings.tsx, lib/usage-range*); GitHub-return params still
  forward to /deployments. Stub boundaries + fill-up list in
  apps/portal/docs/SETTINGS-REDESIGN-GAPS.md (grants endpoint, permit
  ceremony wiring, per-app statement endpoint, rdns brand capture, SVM
  bind re-home). type-check + route-caller test green; verified live on
  PORT=3400.

2026-07-26 — Build Providers page (builder model keys, FE half; branch
  `feat/build-model-keys-tab`, uncommitted, worktree
  `.worktrees/model-keys-tab`). The ACCOUNT-nav Providers page (`/providers`,
  `features/operate/providers-view.tsx`) has one flat card per provider
  (OpenAI/Anthropic/OpenRouter),
  accordion key rows, project-assignment editor, and rotate/remove flows; key
  material is write-only and only the stored prefix renders. Project pages gain
  a read-mostly Providers tab
  (`tabs/providers-tab.tsx`, apply/remove grants for this project; Details
  merged into Home to make room). BFF `/api/bff/operate/model-keys`
  (GET/POST/PUT/DELETE in `server/bff/operate/routes.ts`) fronts the manager
  routes `/api/integrations/github-app/user/model-keys[/:id[/grants]]` via
  five new DeploymentClient methods in `packages/deploy`. The existing
  dedicated Providers ⌘K entry indexes model-provider terms. Per-key usage
  (`usage` / `usageByApplication`, all-time funded-turn sums) comes from the
  manager on each key; the view derives the per-project Tokens/Cost cells from
  it at 1 credit = $0.01.

  Restyled per Cecilia review against the settings-redesign inventory (artifact
  5885e89f…, `.claude/worktrees/settings-redesign`). The project picker is a
  framed PROJECT/SOURCE/FUNDED-BY/TOKENS/COST table with 10px tracked heads,
  checked-row accent fill, sky checkboxes, reassign warnings, per-project usage,
  and an all-time Total row. The expanded key panel now opens with a funding
  summary instead of raw metadata: sponsorship state and project names plus
  wired Projects funded / Tokens sponsored / Provider spend totals; key prefix,
  creation, rotation, and the all-time window remain quiet provenance. The
  assignment section is titled "Add to project" at the same text size as the
  key title and explains: "Use this key to fund projects when users select
  models from this provider." Its table is a frameless white ledger with
  horizontal separators and five evenly sized columns; checkbox state carries
  selection without a row wash. Closed rows keep the key identity in consistent
  monospace type (including user labels such as `prod-main`),
  Active/Unassigned state, and funded-project context. Rotate and the
  solid-red/white Remove action live together in the funding-summary header,
  with each action's flow directly below the summary. The full expanded panel
  uses one wider horizontal inset so its summary, assignment ledger, and flows
  align uniformly on both sides.

  Normalized the Providers radii to apps/build's token mapping: `rounded-md`
  cards/tables/panels (12px), `rounded-sm` in-card controls (8px), and
  `rounded-full` pills. Carried the same recipes into the project-scoped
  Providers tab and shared `status-pill.tsx` / `sdk-badge.tsx` primitives.
  Fixed inert `bg-surface` / `bg-surface-subtle` utilities there. Registered
  the missing `--color-accent-selected-foreground` token so solid-sky Save /
  Add key controls and checkbox ticks use the correct on-accent ink. Simplified
  active sidebar navigation to a uniform sky-500 fill, removing the pale
  two-layer crescent.

  Branch fast-forwarded onto main 9c98c44e (zero overlap). Verified before the
  latest copy pass: aomi-build type-check, vitest 318/318, root deploy suite
  130/130, lint (3 pre-existing warnings), production `next build`, and live
  :3430 light/dark grant save + badge updates with no console errors. After the
  funding-summary and assignment-copy pass: aomi-build type-check is green,
  lint remains at the same 3 warnings, and the :3430 preview shows the unassigned
  state plus the wired active-key totals (2 projects, 1.3M tokens, $9.02).

  Pending BE gap 1: builder keys do not fund dynamic apps yet (they bill
  `app_key` while platform keys pay). Fix BE-side first, then ship without a
  flag. Pending BE gap 2: the FE types/renders
  `ModelKey.usage[applicationId] = {tokens, costUsd}`, but the manager does
  not emit it, so production usage cells remain "—"; only the dev preview has
  real values. Add the manager field on `/user/model-keys` and map it in
  `camelBuilderModelKey`. Deploy order: BE → FE → signed-in smoke (add key →
  apply → chat shows `app_key`).

2026-07-23 — Review-checklist fix pass on
  `codex/widget-auth-single-tenant`: all §1–§4 items and the actionable §5
  items of the (untracked) REVIEW-CHECKLIST.md closed via six parallel
  agents + consolidation. Highlights: provider-plugin no longer eagerly
  creates canonical users (orphan-brick fixed; email upsert now inside the
  advisory-locked transaction via a new `onResolved` hook;
  IdentityConflictError → 409 in the plugin path); deterministic username
  fallback on collision; account deletion no longer blocked by `last_factor`
  (guard stays on unlink; dead 409 branch pruned from the portal DELETE
  route); per-IP rate limiting on all unauthenticated widget-auth routes
  (new `lib/widget-auth/rate-limit.ts`); ba_verifications sweep +
  jsonb-cast-safe session deletion; proxy-aware `isFirstPartyRequest`;
  RS256 pin + `nbf` on Para paths, lazy `PARA_API_BASE_URL`, SIWS strict
  parser reuse, empty untrusted attestations, strict Privy `tokenKind`;
  client widget-session sign-out/fingerprint races fixed (epoch +
  fingerprint guards, 6 new tests), enumerable `required`, sec-vs-ms
  `expires_at` guard, dispose() throws, teardown notifies subscribers;
  wallet-mode widget now boots idle (shared `widgetCredentialsReady`
  predicate), deleteAccount revokes the widget session in try/finally,
  duplicate mount GET /account coalesced, sequential bulk rename/unlink;
  Para startup banner fixed both directions (`useParaStatus().isReady` is
  the readiness signal; 4 new component tests) and JWT cooldown scoped
  per-instance; dead `WidgetAuthAdapter.kind` removed; `safeEnv` collapsed
  to client export; root vitest now includes the portal widget-auth suites;
  `/dev/para-cross-project` spike deleted; `apps/shadcn-registry/dist`
  untracked (staged only); `prepublishOnly` guard on widget-lib. Verified:
  root vitest 816 pass, registry 277 pass, lint + all typechecks clean;
  client/react dists rebuilt, 4 registry JSONs regenerated in
  `apps/landing/public/r/`. NOTE: viem `getAddress` returns plain `string`
  here (abitype register) — the `as \`0x${string}\`` casts are load-bearing.
  Nothing committed. Pending: §6 deploy gates (db-master migration first,
  product-mono PR #855 backend mirror), separate STATE.md ops-detail scrub.

2026-07-23 (current) — Para/Privy Account access subtitles now show only their
  shortened provider-managed wallet values, in EVM/SVM family order and joined
  by a middle dot (for example, `0xda6..f0 · 53GfE..oL`). The chain tags above
  retain the family and access-capability context. Connected SVM wallet
  subtitles now identify the network as `Solana`, parallel to `Ethereum`,
  `Base`, and other resolved EVM network names.

2026-07-23 (current) — Portal/widget thread authentication restored. The live
  BetterAuth/account process was connected to
  `127.0.0.1:54322/aomi_local`, but the manually started Rust backend was
  connected to the remote Supabase database. Account resolution therefore
  succeeded in the Portal while the backend could not find the AccountBearer
  subject and returned 401 only on account-required routes such as
  `GET /api/threads`. Restarting through `scripts/dev-auth-stack.sh` aligned
  both services to `aomi_local`; verified AccountBearer and origin-bound widget
  session requests both return the same 43-thread list with HTTP 200. The React
  runtime now preserves a caller-supplied `localhost` host, and provider widgets
  do not expose a required bearer function until their provider credential is
  ready, removing the transient pre-auth identity errors.

2026-07-23 (current) — Widget-consumer Para Solana root cause confirmed
  against Para's live BETA partner configuration. The Portal project declares
  required `EVM` and `SOLANA` wallet types; the separate consumer/Landing
  project declares required `EVM` only. This is why the canonical Aomi account
  exposes the Portal-created SVM address under Account access while the
  consumer cannot expose an SVM signer under Connected now. A client-side
  auto-create or display-only promotion cannot override the provider project's
  supported wallet families. The Para developer dashboard is open in Chrome
  at sign-in; next step is to enable Solana for the consumer project, then
  logout/relogin in the consumer so Para provisions and exposes its
  project-local SVM wallet.

2026-07-23 (later) — Widget-consumer Para Solana parity: attempted an
  auto-provisioning fix (useCreateWallet({type:"SOLANA"}) after session-up in
  ParaPluginProvider) — user reported it did not help; REVERTED fully. Root
  cause analysis stands: Para wallets are per-project, so the consumer
  project's session holds no SVM wallet even though the Aomi account has one
  linked; "Connected now" is built from the live session
  (para-session-source svm/changed), "Account access" from the backend.
  OPEN: the consumer-side Solana connection gap and the broader
  account-management UI redesign both still need a solution.

2026-07-23 (craft-cleanup pass, uncommitted) — Executed the quality-review
  cleanup of 2b42d79e across three parallel workstreams; net −353 lines
  (1437+/1790−, 83 files), all verified green: root vitest 772 passed/28
  skipped, widget-lib 267/267, account 70/70, portal route tests 23/23,
  client 328, react 125; root + portal typechecks clean; client/react/
  registry dists + landing public/r mirrors regenerated.
  Highlights:
  - Portal: new widgetRoute()/widgetPreflight() wrapper centralizes CORS +
    error mapping (~40 applyWidgetCors call sites and all hand-written
    OPTIONS removed); shared widgetSessionResponse/widgetChallengeResponse;
    shared exchange pipeline lib/widget-auth/exchange.ts; ZodError→400 and
    provider_token_*→401 (was 500); sign-out 500 code unified to
    widget_auth_failed. RESTORED the E2E canonical-user override that
    2b42d79e silently dropped (canonical-session.ts now composes
    resolveE2ECanonicalUserId → resolvePortalCanonicalUserId). Fixed a
    latent split type/value import that made WidgetAuthError undefined
    under Vite SSR.
  - Account: deleted walletClaimTrust, write-only sessionId,
    listWidgetProviders, createAomiUserForBetterAuth, dead imports; merged
    SIWE/SIWS challenge creators (widget-auth/challenge.ts) and wallet
    sign-in near-clones; IDENTITY_SCOPES constants; toMillis reverted to
    millis-only (normalized at widget call site); collectIdentityOwners
    shared; policy param narrowed to { subjectIsEnvironmentGlobal }.
    widgetEnabled KEPT (portal reads it). Public import paths unchanged.
  - Client/widget-lib: safeEnv() helper replaced ~25 typeof-process
    ternaries; thread-store logging now fails CLOSED in no-process prod
    builds; SIWE/SIWS client adapters merged; joinUrl/base64url decode
    deduped into packages/client/src/internal/*; dead getSigner option
    removed (adapter required); useWidgetSessionProvider extracted from
    aomi-backend-runtime; Para banner themed via tokens; paraAuth/privyAuth
    keys required at type level; GetAccountBearer.required typed;
    AomiAccountCredential aliased to client ProviderCredential; unused
    LinkedAuthAccount fields dropped; registry.ts gained the 3 new files.
  - Periphery: GOAL.md indent fix; NEXT_PUBLIC_PARA_SECONDARY_API_KEY
    documented in landing/.env.example.
  Known remaining (unchanged from review): portal test files not matched by
  root vitest include globs (CI gap); pre-existing no-restricted-imports
  lint errors in apps/portal/src/lib/widget-auth (cors.ts et al., +2 from
  new exchange.ts following the same pattern); pre-existing toBeEnabled
  type error in wallet-picker.test.tsx:1324; sign-out race /
  wallet-unlink-revocation / SIWE silent-refresh correctness items still
  open from the earlier review entry.

2026-07-22 (post-push review of 2b42d79e) — Three-agent deep review of the
  widget-auth commit (portal routes/CORS, packages/account, client/widget).
  Verdict: architecture sound; locked decisions (no origin allowlist, no
  audience allowlist, Para env-global subject matching) verified implemented
  as designed; provider-agnostic boundary held (no para/privy literals in
  shared code); client dist matches src. Actionable findings, none
  design-blocking:
  - FIX BEFORE RELEASE: shadcn registry `aomi-para-provider` file list is
    missing `providers/para/para-message-signing.ts` (imported by
    ParaPluginProvider.tsx) → CLI installs of that component break
    (apps/shadcn-registry/src/registry.ts:298-325; dist/registry.json).
  - Sign-out race: `signOut()`/`revoke()` don't cancel the in-flight
    `pending` exchange; a refresh completing after sign-out re-caches a
    fresh WST (packages/client/src/widget-session.ts:258-287).
  - SIWE/SIWS-minted WSTs carry no providerIdentityId, so wallet unlink
    doesn't revoke them (TTL-bounded, ≤30 min).
  - Wallet-mode has no silent refresh → SIWE re-sign prompt ~every 29 min.
  - Provider-token verify errors and ZodError in aomi/provider/exchange
    surface as 500 instead of 4xx (response.ts doesn't map plain Errors).
  - Expired ba_verifications rows never purged; unindexed LIKE scan in
    deleteWidgetSessionsForProviderIdentity.
  - Widget SIWE is EOA-only (no ERC-1271/6492) — scoped out, but silently
    diverges from first-party SIWE.
  - Privy native issuerEnvironment hardcoded "privy:prod"
    (account-credentials.ts:139); dead imports in account-service.ts.
  - Para startup-failure banner (para-plugin.tsx:128-177) can't fire for
    async init failures; provider SDKs are hard deps of widget-lib.
  Deploy dependency confirmed: db-master tenant-column migration must land
  before this serves traffic. Team explainer artifact published
  ("Widget Auth: How It Works").

2026-07-22 (widget auth complete) — Implemented
  WIDGET-AUTH-INTEGRATION-PLAN.md across aomi, db-master, and product-mono.
  Provider identities are tenant-scoped at storage and resolved atomically
  under provider policy; Para widget credentials use pinned environment JWKS
  and arbitrary signed audiences; Portal now issues origin-bound,
  hashed-at-rest, memory-only WSTs for provider, SIWE, and SIWS authentication
  and accepts them through the same account and backend routes as native
  BetterAuth sessions. Added the public AomiWidget/paraAuth package surface,
  isolated provider entrypoints, and a separate-origin Vite consumer. Portal
  keeps its existing local Para project; Landing and the ignored consumer use
  the requested separate BETA browser key. Patch-bumped account 0.1.4, client
  0.3.7, and widget-lib 1.4.9. Isolated migration replay, Rust fmt/clippy,
  lint, typechecks, package/consumer builds and pack verification, 769 root
  tests, 252 registry tests, and the portal test command passed. Phase 8's
  optional pre-creation link-proof flow remains an explicit v1 non-goal.

2026-07-22 (later) — PHASE 0 PASSED (user-confirmed): logout/relogin repeat,
  second-user test, and guest/pregen collision check all succeeded — Para
  cross-tenant global-sub matching is UNBLOCKED (subjectIsEnvironmentGlobal:
  true unconditional for Para, same environment only, never BETA↔PROD). Plan
  updated in place. Two non-gating follow-ups remain in Phase 0: Para written
  sub-immutability confirmation (belt-and-braces) and sanitized token fixtures
  for packages/account/test (needed by Phase-3 verifier tests anyway). The
  data.wallets claimed-vs-pregen classification stays open — walletClaimTrust
  remains "none". Next: start Phase 1 (tenant-aware schema).

2026-07-22 — Widget-auth plan Rev 2: generalized + file-mapped (still uncommitted,
  specs/WIDGET-AUTH-INTEGRATION-PLAN.md). Full codebase mapping (3 parallel
  explorations) folded into the plan. Headline change: a provider-agnostic
  contract — backend `WidgetProviderDescriptor` (credentialSchema,
  verifyWidgetCredential, policy { subjectIsEnvironmentGlobal, walletClaimTrust,
  widgetEnabled }) producing `VerifiedProviderIdentity`; shared code (resolver,
  exchange route, WST, principal, routes, client transport) never names a
  provider. Para = first registry entry (subject global per env, JWKS env-global);
  Privy descriptor ships `widgetEnabled: false` (tenant-scoped keys + app-scoped
  DIDs → cross-tenant matching OFF). Key mapping facts now in the plan: the
  native verifier registry already exists (verifyProviderCredential,
  account-credentials.ts) and is dual-provider; the closed unions blocking a 3rd
  provider are types.ts:117-130, wallet-kit types.ts:274-285, provider-plugin.ts
  zod body, ProvidersConfig; the frontend transport seam is
  clientOptions.getAccountBearer → wrapFetchWithAccountBearer (WST rides it with
  zero runtime changes); wallet-kit lives at src/lib/wallet-kit (NOT components/),
  shadcn-registry has NO tsup (build-registry.js); Phase-1 backfill must include
  privy rows (Rev 1 omitted them); api/widget/auth/{exchange,session,siwe,siws}
  exist as EMPTY untracked scaffold dirs. Locked in Rev 2: unlinking a provider
  identity revokes its WSTs (fail closed). Pending: commit the plan; start
  Phase 1; remaining Phase-0 Para checks gate prod cross-tenant matching only.

2026-07-21 — Widget-auth integration plan written + code-verified (branch
  codex/widget-auth-single-tenant, which is a fresh placeholder == origin/main).
  New specs/WIDGET-AUTH-INTEGRATION-PLAN.md: checklistable Phases 0–9 merging
  PR #339 (AomiWidget/paraAuth UX, tip 2487a5b9) with PR #355 (WST/origin-bound
  transport, tip a586b016) plus net-new tenant-aware identities
  (provider, issuer_environment, tenant_id, subject), an atomic canonical-user
  resolver, a multi-tenant Para verifier, and SIWE/SIWS link-at-first-login.
  Verification corrections folded in (do not re-derive): findConsistentSignalOwner
  does NOT exist (only first-match findFirstSignalOwner — resolver is net-new);
  identity code lives in packages/account (packages/auth is an empty stub);
  schema truth is db-master/migrations (product-mono mirrors schema.rs); the
  2026-07-01 consolidation dropped the per-app `application` column — tenant_id
  deliberately re-scopes the unique index; #339 is mostly already on main (only
  aomi-widget.tsx, paraAuth/privyAuth, widget-consumer, package-dist subpaths
  left to port); #355 verified clean but its principal.ts import must move to
  apps/portal/src/server/canonical-session.ts. Pending: commit the plan doc;
  Phase 0 Para two-project sub-stability experiment gates cross-tenant matching.

2026-07-20 — LIVE SANDBOX VERIFICATION GREEN (branch claude/build-fe-artifacts
  pushed as c0449506; image build-runner:live-1 in VCR under the aomi-build
  Vercel project, e2e-test untouched; AOMI_REF=c0449506,
  AOMI_SDK_REF=b3c0c8b). Full chain proven on real infra with app "dune":
  dispatch → registry row (run id, vercel-sandbox, sandbox name, sidecar
  url) → sidecar /healthz ok + 403 on missing/bogus bearers → BFF file
  route served dune/Cargo.toml FROM THE LIVE VM via a per-request
  portalService() EdDSA bearer → supervise tick "extend" visibly bumped
  the VM timeout 5→14 min → all five stages completed in ~6.5 min with
  Kimi curate inside the VM (only SMITHER_OPENROUTER_API_KEY present, so
  OpenRouter billing is conclusively the path) → supervise "release-
  completed", registry completed, sandbox stopped → file route fell back
  to the store tarball after VM death → download served the real 5.4 KB
  crate tar.gz (Cargo.toml, src/lib.rs, src/tool.rs, test.json).
  BUG FOUND+FIXED during verification (UNCOMMITTED, needs follow-up
  commit): @vercel/sandbox identifies sandboxes by `name` — the Sandbox
  class has NO sandboxId/id getter and Sandbox.get takes {name} — so
  dispatch stored undefined (NOT NULL violation in the registry, one
  orphan VM, stopped) and the supervisor/cancel by-id path could never
  have worked. Fix: adaptSdkSandbox maps name→SandboxLike.sandboxId;
  Sandbox.get({name, resume:false}) so managing a dead VM never
  resurrects it; registry INSERT coerces NOT NULL columns. Two orphan
  runs in the store from the broken first dispatch (smither-dune-a839ce90,
  status running, dead heartbeat, no registry row — invisible to the
  supervisor, harmless cruft). Live rig: worktree
  .claude/worktrees/build-live-verify (detached at c0449506) on :3220 via
  scratchpad run-build-dev.sh (launch.json entry aomi-build-live-sandbox);
  staging topology + portal .env.local signing key so sidecar bearers
  verify.

2026-07-20 — /build multi-user + lifecycle fixes (branch
  claude/build-fe-artifacts, staged, uncommitted). Four design fixes from
  the FE-gap discussion, all live-verified against the Supabase store:
  (1) sessions persist runId/app — reloads reattach to live runs and
  Download survives; localStorage v2. (2) aomi_build_runs registry keyed
  (owner_login, app) in the run store (registry.ts; created idempotently
  via new smither storeQuery raw-SQL seam): Alice/arb-bot ≠ Bob/arb-bot,
  BFF restarts look runs up instead of minting ids (resilience finding #2
  fixed), plan_json persisted so observers/sandbox runs stop recomposing
  plans; owner = GitHub login ("dev" when AOMI_BUILD_ALLOW_ANON).
  (3) system-owned sandbox lifetime: supervisor.ts joins registry rows to
  the engine heartbeat in _smithers_runs — extends live work, reaps
  silent-death VMs after 2min grace (the 18:06/$4 zombie class, finding
  #1) and stale-heartbeat runs (finding #3), releases on settle; ticks via
  GET /api/bff/build/supervise (BUILD_RUN_CHECKER_CRON_SECRET-guarded — cron wiring
  is Phase-4) + in-process interval on long-lived servers; cancel now
  flips the registry + stops the sandbox by id even after restarts.
  (4) live files: infra/build-runner/sidecar.ts (Bun, bearer-auth,
  path-jailed /tree + /file on exposed port 8722) baked into the image;
  dispatch launches it; BFF GET /api/bff/build/runs/file serves file
  contents from local disk → live sidecar → store tarball (minimal ustar
  reader tar.ts — file contents readable even after the sandbox dies);
  Files panel is now a click-to-view source browser (dialog in
  build-view). NOTE: WebSocket ruled out (Vercel Functions can't host WS;
  SSE relay is the later polish); sidecar needs the next image rebuild to
  exist in VMs. 83 smither + 286 app tests green; typecheck/lint clean.
  Live-verified: registry row (dev|geckoterminal|completed|local),
  resume-not-remint, file route serving real lib.rs, supervise route
  responding.

  Addendum (Cecilia review): sidecar auth now rides the OFFICIAL
  service-bearer path instead of a homegrown random-UUID token. The BFF
  mints a fresh 5-min EdDSA JWT per proxied request via portalService()
  (PORTAL_SERVICE_PRIVATE_KEY + committed topology; new module
  apps/aomi-build/src/server/bff/build/sidecar-auth.ts), audience
  "aomi-sidecar" (added to aomi-bff's audiences in packages/account
  topology-data.ts and the three aomi-build service.portal*.toml — a
  leaked bearer is useless at the backend), subject = run id. The sidecar
  verifies the JWT with WebCrypto Ed25519 against aomi-bff's committed
  PUBLIC key (AOMI_SIDECAR_PUBKEY env — no secret in the VM), pins
  iss/aud/sub/exp, fails closed. sidecar_token is gone from the registry
  (no stored secret anywhere; the Supabase column's DEFAULT '' absorbs
  omitted inserts). Round-trip + tamper tests in sidecar-auth.test.ts;
  live-verified: real PORTAL_SERVICE_PRIVATE_KEY (portal .env.local,
  staging topology) → portalService().mint → sidecar verifyBearer OK,
  wrong run id rejected. NOTE: apps/portal's service.portal*.toml were
  NOT touched (portal never mints the sidecar audience) — flag if
  topology views should stay byte-identical.

2026-07-19 (night, 2nd session) — /build agent billing: OpenRouter is now the
  DEFAULT, Anthropic the env-only backup (uncommitted, stacked on the
  build-fe-artifacts working tree). Motivation: first-party Anthropic is too
  expensive for builder runs. `resolveAgentBilling` (packages/smither/src/
  agents.ts): SMITHER_OPENROUTER_API_KEY > SMITHER_ANTHROPIC_API_KEY > local
  CLI login; not user-selectable, pure deployment config. OpenRouter path
  drives the same claude CLI via OpenRouter's Anthropic-compatible endpoint
  (https://openrouter.ai/api): ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN +
  ANTHROPIC_API_KEY pinned "" (never fall back to first-party auth) +
  ANTHROPIC_MODEL/ANTHROPIC_SMALL_FAST_MODEL both set. Default model
  moonshotai/kimi-k2.7-code ($0.72/$3.50 per M) — deliberately NOT kimi-k3
  (July 16 release, but Sonnet-priced $3/$15, defeats the point); override
  via SMITHER_OPENROUTER_MODEL. dispatchSandboxRun passes both new vars into
  the microVM; BFF local runner + run-plan CLI already forward process.env.
  Caveat (OpenRouter's own docs): claude CLI is only *guaranteed* against the
  Anthropic first-party provider — third-party-model tool-calling fidelity is
  the risk, and regressions surface as validate-loop maxIterations failures.
  Cloud verification of a Kimi-billed run still pending (needs the env set on
  a dispatch). Phase-4 decisions recorded from Cecilia: 5 build chats/apps per
  user; build tokens NEVER hit the cost dashboard (chat+project only); quotas
  + sessions live in the separate aomi-build-smither Supabase DB; GitHub login
  required + invite allowlist; image-SDK sync via GitHub Action (design in
  convo: images tagged build-runner:sdk-<ver>, repository_dispatch from
  aomi-sdk release, green-canary gate before activation). SECURITY: an
  OpenRouter key was pasted into chat — must be rotated before any env setup
  uses it. Verified: smither build + 83/83, aomi-build type-check + 284/284,
  lint clean (3 pre-existing warnings).

2026-07-19 (night) — /build FE gap: store-served crate artifacts, hosted
  store provisioned (branch claude/build-fe-artifacts, uncommitted).
  Supabase project "aomi-build-smither" (ref ijhknhtjabljnqwmimrv,
  us-east-1, org aomi) is the hosted smithers store; engine bootstrapped
  all 25 _smithers_* tables + synced new columns on first connect; URL in
  apps/aomi-build/.env.smither.local (gitignored; session pooler :5432 —
  NOT the :6543 transaction pooler). New artifact pipeline: the result
  phase packages the crate (packages/smither/src/artifacts.ts — file-tree
  JSON + base64 tar.gz ≤2.5MB, warning on skip; executeRun raises
  maxOutputBytes to 4MB) into the durable result row; BFF serves Files
  and Download from the store when the crate isn't on local disk
  (run-view artifactFromOutputs, engine storedCrateTarball, download
  route fallback) — sandbox runs get real artifacts. Also: builder
  passthrough on POST /runs (claude|codex|none; "none" = deterministic
  pipeline, no LLM), mapper trusts run-level status over stale failed
  stage rows (cross-attempt resumes), localStorage sessions bumped to v2
  (v1 TS-mock fiction purged on load). Verified E2E on Supabase:
  builder:none run green (binaries/codegen/validate/result), artifact row
  669B tree + 67KB tar, then a fresh observer instance with an EMPTY SDK
  root served the tree + a decodable 50KB tarball purely from the store —
  the deployed-Vercel shape. Quota lesson re-confirmed: local claude CLI
  keychain subscription outranks SMITHER_ANTHROPIC_API_KEY (a geckoterminal
  run sits waiting-quota in the store; resumable). Cloud sandbox proof of
  the artifact path needs an image rebuild from a pushed sha — Cecilia's
  go. 77 smither + 284 app tests green; typecheck/lint clean.

2026-07-19 (evening) — /build sandbox-mode: FULLY GREEN CLOUD RUN.
  `smither-defillama-ea2a9cba…` completed all five stages in a real Vercel
  Sandbox booted from the rust-1.92 image: binaries ✓ codegen (kept
  existing sources) ✓ curate (real analysis: caught a dangling
  `defillama_get_yield_pool_history` tool reference) ✓ validate ✓ result ✓
  — run status `completed`, curation + result served by the BFF from the
  shared store. Phase 1–3 acceptance fully demonstrated on real infra.
  (Empty fileTree / 409 download for sandbox runs remain the known Phase-4
  gap.) Two more operational facts confirmed on the way: a stale
  VERCEL_OIDC_TOKEN (12 h life) makes Sandbox.create succeed but the VM
  die silently before its first store write — refresh with `vercel env
  pull` before dispatching; and the lazy keepalive is real — a run watched
  only via direct store reads (bypassing the BFF poll path) lets its
  sandbox lapse at the 5-minute create ceiling mid-stage, exactly the
  documented abandoned-run behavior. Test rig torn down (BFF :3210, ngrok
  tunnel, throwaway Postgres :5455).


2026-07-19 — /build ship: FIRST real Vercel sandbox-mode dispatch, chain
  verified end-to-end on actual Vercel infra (PR #370 carries it all).
  Golden image (debian:bookworm-slim, linux/amd64+zstd) pushed to VCR
  (`build-runner:e2e-test`, ~1 GB, Ready) → `Sandbox.create({image})` boots a
  real microVM → `run-plan` on Bun → binaries ✓ codegen ✓ claude curate
  agent ✓ validate ✓, run state flowing to Postgres with the BFF observing.
  Fix chain to get there (each its own commit): deterministic run-plan
  sanity probe; VCR's 500 MB compressed-layer cap (slimmed cargo layer;
  filtered `pnpm install --filter "@aomi-labs/smither..."`; CI=true prod
  re-install; explicit pnpm-store rm — `$(pnpm store path)` expanded empty
  and silently shipped 1.5 GB); Node from official tarball (nodesource
  stopped shipping npm); codegenStep re-derives plan source at execution
  time (sandbox plans compose as "discover", so committed apps hit remote
  gen-specs and failed); IS_SANDBOX=1 in dispatch env (claude CLI refuses
  skip-permissions as root). Final run settled "failed: validate-loop
  reached maxIterations 3" — forensics show the IMAGE was the defect, not
  the crate: minimal rustup profile lacked rustfmt (round 0) and clippy
  (round 1), and rustc 1.88 < aomi-sdk's rust-version 1.91 (round 2); the
  repair agent spent all rounds fixing the toolchain by hand. Dockerfile
  now: rust 1.92.0 + rustfmt/clippy components (rebuild + green-run rerun
  pending). Resilience findings REPORTED, not yet fixed (Cecilia to route:
  this PR vs follow-ups): (1) engine pg client never reconnects after a
  connection blip (ngrok hiccup bricked BFF reads until restart, twice);
  (2) sandbox run-id reuse is process-local registry — BFF restart mints
  new run ids instead of resuming (same disease as the fixed run.json bug;
  store should be the lookup); (3) cancel of a dead-sandbox run wedges the
  app on that instance (stopSandbox kills the engine before it settles the
  store status). Session housekeeping: 41 MB of .smithers run state is
  committed on MAIN (separate cleanup task spun off; image just rm's it);
  vercel CLI 54→56.3.2 (for `vercel vcr login docker`); headless agent
  billing = SMITHER_ANTHROPIC_API_KEY (renamed from AOMI_BUILDER_API_KEY)
  so sandbox runs never share the interactive Claude subscription quota.


2026-07-17 (night) — smithers-orchestrator 0.27.0 → 0.28.0 upgrade (in tree,
  unverified tail): packages/smither now `^0.28.0` + effect pinned 3.21.4;
  bun-compat drops the `Bun.which: () => null` polyfill (0.28's resolveBinary
  trusts a function-typed `which` with no PATH fallback — the stub broke
  git/claude resolution; `Bun.sleep` kept as cheap insurance); raw-TS loader
  hooks STILL required on 0.28.0 (plain-JS packaging lands only in releases
  after it). Verified: smither build + 73/73, aomi-build type-check + 229/229
  + lint, and on the two-instance Postgres E2E the compute stages
  (binaries/codegen) complete under Node with cross-instance observation
  intact. Found+fixed a 0.28 delta: engine settles quota-hit runs as new
  status `waiting-quota` (retries preserved, later create resumes) — wire
  mapping moved it running→failed (run-view.ts) so pages don't show an
  eternal spinner; in-memory engine.ts mapping already agreed. PARKED_STATUSES
  comment notes 0.28's `paused` (we never pass pauseSignal).
  Preserved-retry resume CONFIRMED after the quota window reset (~01:21am):
  re-creating the same app minted no new run id, resumed straight into
  `curate` (not a redo of binaries/codegen), and made a genuine retry
  attempt — smithers 0.28's "retries are preserved" holds. That attempt
  immediately hit a *fresh* 5-hour quota wall (resets ~2026-07-18 06:20
  local), because this session's own research work billed against the same
  Claude subscription the curate agent uses — not a code issue.
  REMAINING to verify: an agent step actually completing (either wait out
  the new window, or set SMITHER_ANTHROPIC_API_KEY so headless runs bill an API
  key instead of sharing the interactive subscription quota — recommended
  before the next verification pass), the Bun TUI/console surfaces, and a
  golden-image rebuild + sandbox-mode dispatch on 0.28.
  Upgrade audit report (API-surface diff, per-step risk):
  scratchpad smither-on-vercel-report.md + subagent findings; fallback = pin
  back to 0.27.0, store schema read-compatible both ways.


2026-07-17 (evening) — /build ship verification pass over the uncommitted
  Phase 1–3 work + golden-image base swap. (1) Fixed a statelessness bug the
  cross-instance E2E caught on a REAL fresh Postgres (14 on :5455, not the
  PGlite socket stand-in): prepareRun trusted the local run.json pointer and
  resumed a run id the shared store never had → smithers RUN_NOT_FOUND crash;
  prepareRun now checks the store (storeHasRun via SmithersDb.getRun) and a
  stale pointer falls back to a fresh run + rewritten run.json
  (packages/smither/src/run.ts). (2) E2E re-verified end-to-end: create on
  instance A (:3210), instance B (:3211, NEXT_DIST_DIR=.next-b) served
  status/stages mid-run and, at settle, curation, result, fileTree AND the
  crate tarball download (200, 50 KB) for a run it never executed; cancel
  route from B returns ok (run had already completed — cancel-mid-run was
  proven in the Phase 2 pass). (3) Golden image: Vercel Sandbox custom-image
  docs confirm images are plain OCI from VCR with NO base-OS constraint
  (only linux/amd64 manifest; ENTRYPOINT/CMD ignored; WORKDIR honored) — the
  AL2023 assumption was wrong, base swapped to debian:bookworm-slim
  (dnf→apt) and README push flow corrected to
  `docker buildx build --platform linux/amd64` + zstd (a plain build on an
  ARM Mac lands as `Unoptimized` in VCR and Sandbox rejects it; wait for
  `Ready`, else image_not_ready). Full sweep green after the fix: smither
  build + 73/73 tests, aomi-build type-check + 229/229 tests + lint.

2026-07-17 — /build ship Phase 3 (review-ready; real provisioning blocked on
  Vercel/API-key decisions): SandboxRunner. BFF dispatches
  `aomi-smither run-plan --plan-b64 … --run-id …` into a Vercel Sandbox
  booted from the golden image (infra/build-runner/{Dockerfile,README.md}:
  AL2023 + Rust + Bun + Node + claude CLI + pinned aomi-sdk with prebuilt
  release binaries + built smither package). AOMI_BUILD_RUNNER=vercel-sandbox
  branch in the engine (composePlan sdkRoot override, pre-allocated run id,
  settled-app re-create reuses the run id so run-plan resumes from store
  state); serverless keepalive = lazy extendTimeout from the poll path;
  cancel = durable store write + best-effort sandbox stop. @vercel/sandbox
  behind an injectable SandboxClientLike seam (sandbox-runner.ts, 4 tests
  with a fake client; SDK v2.7 API verified from the published types).
  run-plan now resumes when the shared store already knows the run id even
  with no local run.json (fresh-sandbox continuation). Local runner
  regression E2E green after the refactor (5/5 stages, curation present).
  Sandbox-mode known gaps (Phase 4): Files panel/download read local fs —
  empty for sandbox runs; cross-instance sandbox extend/stop and quotas need
  the build_runs registry decision; sandbox-mode plans always use discover
  (server can't stat the image's apps/).

2026-07-17 — /build ship Phase 2 (specs/BUILD-SHIP-E2E-PLAN.md): runner seam.
  packages/smither: `aomi-smither run-plan` headless subcommand (--plan/
  --plan-b64 JSON, optional pre-allocated --run-id via createRunState/
  prepareRun runId option) — smoked on Bun (resume replay, exit 0; custom
  run-id lands in run.json); `requestRunCancel` (durable
  cancel_requested_at_ms write the engine polls — cancel works from any
  process); makeWorkAgent takes apiKey, wired from SMITHER_ANTHROPIC_API_KEY so
  headless runners bill an API key instead of a CLI login. BFF: Runner seam
  (AOMI_BUILD_RUNNER, LocalRunner today, SandboxRunner = phase 3 slot),
  cancelBuildRun + POST /api/bff/build/runs/cancel, Esc on the page cancels
  the real run. Cancel E2E verified against shared Postgres: store status
  `cancelled`, codegen node cancelled mid-flight. Note: wire status maps
  cancelled→failed (no distinct wire state yet — P1 polish).

2026-07-16 — /build ship Phase 1 (specs/BUILD-SHIP-E2E-PLAN.md): stateless
  BFF over the durable store. packages/smither gains readRunView (run status
  + per-node states from _smithers_runs/_smithers_nodes + outputs) and
  prepareRun accepts a shared api handle; the BFF snapshot now derives
  status/stages/curation/result from the store every poll (live reducer is
  garnish), one store handle per app (PGlite can't double-open), and a
  registry miss reconstructs an observer handle from the store
  (reconstructBuildRun — recomposed plan, no filesystem). Pure derivation in
  server/bff/build/run-view.ts (+6 tests). Acceptance verified: two dev
  instances over one shared Postgres (PGlite socket stand-in on :15432) —
  create on A, poll on B mid-run and at settle; B served stages, curation,
  result, fileTree for a run it never executed. next.config distDir is
  NEXT_DIST_DIR-overridable for multi-instance local testing.
  Pending decision: build_runs registry table home (dedicated PG vs backend
  Supabase) — needed for Phase 2 runner bookkeeping.

2026-07-16 — /build P0 honest artifacts (gap map: specs/BUILD-PAGE-WIRING-GAP.md):
  engine snapshot now carries the real crate file tree (walk of
  sdkRoot/apps/<app>, target/ excluded), the curate agent's structured
  report (loadRunOutputs reads curation/result rows — covers replayed
  resumes), and per-stage transition times; completion message = curation
  summary + followUps verbatim; download = crate tarball route
  (GET /api/bff/build/runs/download) wired to the Ship banner button;
  mock artifacts swapped to the real Rust crate shape (Cargo.toml,
  openapi.yaml, src/{lib.rs,client/,tool.rs}, test.json) — flow unchanged.
  Verified E2E in-browser against the resumed geckoterminal run.

2026-07-16 — /build E2E verified in-browser against a REAL smither run
  (geckoterminal: binaries → codegen → curate via live Claude agent →
  validate-loop cargo → result; resume replay lands the page on Ship). Fixes
  found by the E2E: workflow.tsx ok/green checks must be truthy not `=== true`
  (booleans round-trip as 0/1 through the store); bun-compat gained a minimal
  `Bun` global polyfill (sleep/which, no `version` so isBunRuntime stays
  honest) and a functional node:sqlite-backed bun:sqlite shim (the engine's
  single-runner opens an in-memory scratch sqlite on every backend); engine
  maps RunStatus "finished"/"continued" (not "completed"), captures
  result.error, backfills stage statuses on replayed completed runs, and
  auto-resumes settled apps on re-POST;
2026-07-16 — /build wired to real aomi-smither (flagged): smithers-orchestrator
  0.26.1→0.27.0 (Node ≥22 + pglite/postgres backends via new SmitherBackend
  seam in packages/smither run.ts/workflow.tsx; SMITHER_DATABASE_URL wins,
  Bun keeps bun:sqlite, Node falls back to per-app PGlite); aomi-build BFF
  build engine (src/server/bff/build/engine.ts + routes; POST/GET
  /api/bff/build/runs, POST /api/bff/build/runs/decision; GitHub session +
  origin + rate-limit gated; autoApprove default until UI renders approvals);
  Node loader hooks for Bun-flavored smithers sources (src/instrumentation.ts
  + src/server/bun-compat.ts; serverExternalPackages in next.config.ts);
  use-build-session drives the real engine when NEXT_PUBLIC_BUILD_ENGINE=
  smither (poll → smither-run-mapper.ts, mock pipeline unchanged by default);
2026-07-19 — Operate: BE statement vocabulary + example-data fallback (designs
  visible pre-BE; fixtures moved to features/operate/fixtures);
2026-07-16 — Bots page 404 root-caused to product-mono edge routing;
2026-07-16 — Environment tab: unified Variables list (declared slots + configured, `*` = required);
2026-07-16 — PR #358 (+): env-aware default chat host (prod → chat.aomi.dev,
  preview/dev → chat-staging.aomi.dev; NEXT_PUBLIC_CHAT_URL still overrides);
2026-07-14 — Account menu: Docs (aomi.dev/docs) + Home page links (Vercel-style);
2026-07-14 — Build P2 deep-link polish (⌘K / Billing / Overview → right tab);
2026-07-14 — Create stack #343–#349 merged to main (left #340);
2026-07-14 — Create Recent rail UX: one Create-header toggle (no double collapse);
2026-07-14 — Create Recent rail: user open/collapse + localStorage (⌘B);
2026-07-14 — Create composer: UI-only model picker mock (Aomi + Soon);
2026-07-14 — Create templates: Browse all opens a sheet;
2026-07-14 — Create mobile: hide Plan steps when Progress is in-thread;
2026-07-14 — Create Recent titles: derive + dedupe (hello → unique);
2026-07-14 — Create craft polish tranche (rail/empty/chat/stage/composer);
2026-07-14 — Create craft review: jargon migrate + canvas;
2026-07-14 — Create UI: builder language (no eng keywords in chat/sidebar);
2026-07-14 — AI Builder P3 (#344): nodes + compile/aomi-run (review local first);
2026-07-14 — AI Builder P0–P2 (#343): Create craft on /build;
2026-07-14 — AI Builder P1 craft port: mock layout feel in ControlPlaneShell
  (composer, stream, files, ship→Projects, in-page history; local mock timers);
2026-07-14 — AI Builder P1: intent composer + templates + local session;
2026-07-14 — AI-BUILDER-EXPERIENCE.md (Create / chat-mock port plan);
2026-07-14 — Build AI Builder: enable sidebar Build + `/build` scaffold;
2026-07-13 — Build P2 usage peek (Home meter → Operate Usage);
2026-07-13 — Build P2 Deployments timeline (history that reads as history);
2026-07-13 — Build Live status consistency (one story across list/Home/Deployments);
2026-07-13 — Build P2 Project home (live / keys / Open Chat / usage glance);
2026-07-13 — Build P1 control plane: ⌘K, toasts, Projects landing, glossary;
2026-07-13 — Build P0 trust: Soon labels, gate Integrations Save, human errors;
2026-07-13 — Build UI copy polish (em dashes / hedging essays);
2026-07-13 — Billing option A: methods live on Chat (no fake Build fetch);
2026-07-13 — Fixed required-secrets gate fail-open (P1, external review);
2026-07-13 — BILLING-EXPERIENCE.md: backend ↔ UI map (code-checked)

## Required-secret gate hid the app it blocked on (2026-07-27)

Reported on build-staging `/projects/1580?tab=deployments`: deploying failed
with `Missing required secrets — <app>: <KEY>`, but nothing offered a place to
enter the value — no gate banner with "Set required secrets", and the
Environment tab listed no such variable.

Cause: `redeploySource` runs `launchPreflight`, which re-syncs the source from
the repo (`syncSource`, `server/bff/launch/routes.ts:301`) and returns
`pre.apps` from the *preflight deployment*. HEAD's `aomi.toml` can therefore
register apps the page's `source` snapshot predates. `ensureRequiredSecrets`
gates on `pre.apps` (fresh), while the gate banner
(`deployments-tab.tsx`) and the Environment tab's app list
(`environment-tab.tsx`) both enumerate `source.apps` (stale) — so the deploy
error could name an app neither surface would render a row for. It also
explains why Deploy was clickable at all: the initial gate only checked the
old app set and saw nothing missing.

- `use-project-detail.ts`: `redeploySource` now `await reload()`s between
  preflight and the required-secret check, so `source.apps` reflects what the
  gate is about to check.
- `deployments-tab.tsx` / `environment-tab.tsx`: apps are the **union** of
  `source.apps` and the `requiredSecrets` keys, so an app the check flagged is
  always listed (and settable) even if the source snapshot lags.
- `environment-tab.tsx` now renders `requiredSecretsError` with a Retry — it
  was swallowed, so a failed check rendered as "this app has no required
  secrets", the opposite of the truth. This blind spot was never covered.
- Tests: 3 added (env tab union + error banner, hook refresh-before-gate;
  the hook test fails without the `reload()`). Launch suite 142 pass, tsc and
  eslint clean.

Not verified against staging data: the exact app/KEY pair is whatever the
repo's current `aomi.toml` declares. If the symptom persists after a hard
reload, capture
`/api/bff/deployments/required-secrets?appSourceId=<id>` (status + body) — a
503 there means `RequiredSecretsCheckError` (missing `GITHUB_TOKEN`,
unresolvable `platformRepo`, or an unreadable release `manifest.json`), which
is a different failure with the same silent-UI symptom.

## Operate statement + example-data fallback (2026-07-19)

Branch `feat/operate-console-mocks` (uncommitted working tree):

- Usage statement contract renamed to the manager's vocabulary: subjects
  (`tool_invocation`/`outcome` earn; `model`/`hosting` charge), signed
  `entries`, raw USD floats formatted at render time (`format.ts`).
- Deploy client: `getUserSourceStatement()` → `/user/sources/:id/statement`
  (BFF fetches it in parallel with usage; `available:false` → drop source).
- Fixtures moved `app/dev-operate-preview/fixtures/` →
  `features/operate/fixtures/` (per-app: card/detail/transactions/logs/
  statement). New `fixtures/wire.ts` builds BFF-wire example payloads,
  shared by the dev harness and the BFF fallback.
- BFF fallback (until BE parity): usage serves the example statement when
  the manager has none; observability grafts example 24h trends onto live
  cards (real fields win per-field) and serves full example cards when the
  account has no apps. Filled payloads carry `example: true`; the page
  header shows an "Example data" badge. Delete the fallback branches in
  `server/bff/operate/routes.ts` once BE ships.

Pending (backend, in progress by Cecilia):

- Manager `/user/sources/:id/statement` + `statement_entries` migration
  (exists only on the unmerged `aa-c2-sign-handoff` BE worktree).
- Observability 24h trend fields (`chats_24h`, `*_hourly`, tool/tx error
  split, cold start, dylib size) from grouped query_range reads.

## Bots page `list_user_source_bots failed (404)` fix (2026-07-16)

- Cause was NOT in this repo: the dev edge proxy (product-mono
  `scripts/dev-edge-proxy.mjs`, which imports `isManagerPath` from
  `infra/cloudflare/worker/src/index.js`) had no `bots` entry in
  `MANAGER_ROUTE_PATTERNS`, so `/api/integrations/github-app/user/sources/:id/bots`
  fell through to the backend (:8080) instead of the manager (:8081) → 404.
- Fixed in product-mono (branch `feat/builder-owned-github-bots`, commit
  20c220b41): added
  `/^\/api\/integrations\/github-app\/user\/sources\/[^/]+\/bots(\/[^/]+)?$/`
  and restarted the dev proxy. Verified bots/agents/sources all reach the manager.
- Pending: redeploy the Cloudflare worker before staging/prod use the bots tab,
  or the same 404 recurs there.

## Required-secrets gate fail-open fix (2026-07-13)

Branch `feat/required-secrets-gating`, commit `5b5dea59`. External code review
found the required-secret activation/promotion gate ALWAYS failed open in
production: `missingSecretsForActivation`
(`packages/deploy/src/bff/release-manifest.ts`) read
`input.source.latestDeployment?.platformRepo`, but `source` comes from
`listUserSources`, and the backend deliberately returns
`latest_deployment: null` on that list endpoint (lazy for the list). So
`platformRepo` was always undefined and the gate silently returned `{}` —
activate, promote, and `requiredSecretsRoute` all saw zero required secret
slots regardless of what was actually missing. The existing tests hid this by
stubbing a populated `latestDeployment`, a shape that never occurs in
production.

- **Fix**: `missingSecretsForActivation` now resolves `platformRepo` via
  `client.getUserSourceLatestDeployment(...)` (the per-source detail endpoint
  that does populate it, same pattern as the redeploy route) when the cheap
  `source.latestDeployment?.platformRepo` path is empty. Fail-open is
  preserved only for the genuinely-unknown case (no GitHub token, or a source
  with no deployment at all). Fixes aomi-build + portal activate/promote
  (shared helper) plus aomi-build's `requiredSecretsRoute` (same pattern,
  fixed separately since it doesn't go through the shared helper).
- **Tests**: rewrote fixtures across
  `packages/deploy/test/release-manifest.test.ts`,
  `apps/build/src/server/bff/launch/routes.test.ts`,
  `apps/portal/src/server/bff/launch/routes.test.ts`, and
  `packages/deploy/test/launch-routes.test.ts` to use the real
  `latestDeployment: null` shape with a `getUserSourceLatestDeployment` stub,
  so they exercise the real production path instead of masking the bug.
  Proved the regression: reverted only `release-manifest.ts`, confirmed the
  corrected test fails against the old code (`{}` instead of the expected
  missing-secret map), then restored and confirmed it passes.
- **Verified**: all four vitest suites green (107 tests total across the
  four files), `@aomi-labs/deploy` build clean, `aomi-build` + `portal`
  type-check clean.
- Full writeup: `.superpowers/sdd/fix-p1-failopen-report.md`.

## Environment tab unified Variables view (2026-07-16)

`apps/build/src/features/launch/components/deployments/tabs/environment-tab.tsx`:

- Merged the split "missing required inputs inside Add or overwrite" +
  "Configured" sections into one **Variables** list: declared manifest slots
  (required + optional) and configured vault keys in a single view.
- Missing slots render as solid list rows (`Not set` chip, warning-tinted when
  required) with a **Set value** action that prefills the Add-or-overwrite
  editor — no more read-only key inputs injected into the editor.
- Required slots marked with `*` (+ legend "Required — the app cannot be
  activated without it"); optional declared slots now visible too.
- Missing-required rows sort first, directly under the "N required secrets
  missing" banner; custom configured keys follow declared slots.
- Removed the `requiredValues` state path from save(). Tests updated/added in
  `environment-tab.test.tsx` (8 pass; full launch suite 129 pass; lint clean;
  tsc failure is pre-existing stale `.next/types/validator.ts` on main).

## Build P2 deep-link polish (2026-07-14)

Branch `feat/build-p2-deep-links`:

- Shared `deep-links.ts` for project tabs, last-project Home, Environment, Usage.
- ⌘K Last project / Environment / Usage prefer last project when set.
- Overview recent deploys → project Deployments tab; Usage card / Billing links
  use last-project scoped Usage / Environment when available.

## Create Recent sidebar toggle (2026-07-14)

Branch `feat/build-recent-sidebar-toggle` (stack on #344 / p3):

- Single mental model: Recent open OR closed.
- Primary control: Create header panel icon (always visible); ⌘/Ctrl+B same state.
- Closed = no left rail (header toggle reopens); removed in-Recent collapse + narrow History rail.
- Preference persisted in localStorage; first visit defaults open on xl+ (after mount; SSR-safe).
- Shell nav remains click-only.

## Create composer model picker mock (2026-07-14)

Branch `feat/build-model-picker-mock` (stack on #344):

- Cursor-like model control on Create composer (`ComposerModelPicker`).
- Current selection: **Aomi** only; Auto / Custom rows disabled with Soon.
- Hardcoded mock — no Han API, no fake live model list fetch.
- Keeps quiet **Preview** honesty chip beside the picker (no Aomi branding spam).
- Product language only (no Smithers / eng jargon in UI).

## Create template Browse all sheet (2026-07-14)

- Empty Create keeps 3 featured templates; “Browse all” opens a right sheet
  with the full template grid (Esc / overlay / X to dismiss).

## Create mobile Progress/Plan dedupe (2026-07-14)

- On `<lg`, Plan-steps cards stay hidden during generate so they do not compete
  with the in-thread Progress timeline (rail Progress is lg+ only).

## Create Recent title dedupe (2026-07-14)

- `deriveSessionTitle` strips greeting fluff + soft-truncates; `uniqueSessionTitle`
  avoids colliding sidebar labels; list remasters persisted dupes for display.

## Create craft polish tranche (2026-07-14)

Shipped the review next-tranche on Create (`/build`):

- Right rail: single Progress timeline + Files (removed duplicate Build plan).
- Empty Create: top-anchored hero, 3 featured templates + Browse all.
- Chat density: tighter message/banner spacing; less mid-thread void.
- Stage strip: `resolveDisplayJourneyStage` + verify-gate stream honesty
  (Compile & test stays active until smoke test; Ship only when shipReady).
- Composer: Preview chip only (no stacked Aomi / model chip) — superseded by
  model picker mock above for the picker PR.

## Create craft review + jargon migrate (2026-07-14)

Screenshot review of empty Create + active session:

- Stale localStorage still showed Local mock / Smithers / aomi-run after the
  product-language pass — added `sanitize-session-copy` on load/save +
  display guards; dropped redundant empty-state `aomi` chip and dual rail titles.
- Craft canvas: `canvases/aomi-build-create-craft-review.canvas.tsx`
- Follow-up tranche shipped (see above): rail / empty / chat / stage / composer.

## Create product-language polish (2026-07-14)

Branch `feat/build-p3-smithers-nodes`:

- UI copy uses builder language only: Plan / Generator / Smoke test / Aomi /
  Ready / Preview. Eng names (Smithers, aomi-run, Local mock, Han, etc.) stay
  in types/comments, not rendered labels.
- Chat: You (right) / Aomi (assistant) / quiet system; seed model = Aomi.
- Sidebar sessions: Ready / In progress / Failed + journey stage titles.
- Ship banner: Ready to ship + Download / Open Projects; GitHub init · soon.
- Composer chip: Preview; blocked hint says smoke test (not aomi-run).

## AI Builder P1 craft port (2026-07-14)

Branch `feat/build-enable-route`:

- Ported mock portal craft into `features/build/` inside ControlPlaneShell
  (no BuildLayout, no Customize marketplace, no `/deploy/[id]`).
- Empty: centered composer + templates; active: thread + stream, lg context
  (files/stream), sticky compact composer, xl session list.
- LocalStorage mock pipeline plan→generate→validate→ready mapped to journey
  stages; ship banner → `/projects`; honest “Local mock” copy.

## AI Builder P1 intent empty state (2026-07-14)

Branch `feat/build-enable-route`:

- Working intent composer + 8 templates (seed prompts).
- Submit creates a local Create session + journey chrome.
- Superseded visually by craft port (stream/files landed).

## AI Builder experience plan (2026-07-14)

- Added `apps/build/AI-BUILDER-EXPERIENCE.md`: Cecilia decode, platform
  map, mock-vs-target, import policy, P0–P5 implementation phases.
- Direction: adapt mock craft into live `features/build/` (not wholesale port).

## Build AI Builder route (2026-07-14)

Branch `feat/build-enable-route`:

- Sidebar Build `enabled: true` (no Soon).
- Real `/build` page scaffold: journey map + disabled “Start” (no Smithers
  network yet). Manage path still Projects / Operate.

## Build P2 usage peek (2026-07-13)

Branch `feat/build-p2-usage-peek` (PR #335):

- Home Usage card: credits + tokens + day spark; Environment ≠ Billing copy.
- Deep link `/operate/usage?project=<id>`; Operate honors `?project=`.

## Build P2 Deployments timeline (2026-07-13)

Branch `feat/build-p2-deployments-timeline` (PR #334):

- Deployments tab summary uses the same Live story + history count.
- Rows lead with app names + Current; deployment id is secondary.
- Current sorts first; relative timestamps; History / Promotions labels.

## Build Live status consistency (2026-07-13)

Branch `fix/build-live-status-consistency` (PR #331):

- Shared `projectDeploymentStatus()` wraps `deploymentLifecycleFromSource`
  so Projects list, Home, and Deployments tell the same Live story.
- Deployments empty state: if live but records `[]`, show
  "No deployment history yet" instead of "No deployments yet".

## Build P2 Project home (2026-07-13)

Branch `feat/build-p2-project-home` (PR #330):

- Project pages default to a **Home** tab with Live / Environment / Chat /
  Usage status cards and one Next CTA (deploy → keys → Open Chat).
- Reuses `deploymentLifecycleFromSource`, secrets load, and operate usage peek.
- Existing Deployments / Chat / Environment / Details tabs unchanged.

## Build UI copy polish (2026-07-13)

Branch `fix/build-ui-copy-polish`:

- Shortened Settings, Billing, Secrets, Overview, Usage, Environment,
  Integrations, and wizard user-facing copy.
- Removed AI em dashes from product sentences; kept `—` only as empty
  table/stat placeholders.

## Build P0 trust — Soon, don't delete (2026-07-13)

Branch `fix/build-p0-trust-soon`:

- Integrations: Save gated (`Save · Soon`); no fake success on 501; forms kept.
- Settings: `Planned` → `Soon`; unfinished sections stay listed as Coming soon.
- Project Disconnect kept as `Disconnect · Soon` (disabled).
- Sidebar Build already Soon (unchanged).
- Auth sign-in + env errors humanized (`humanizeUserError`); no bearer essays.

## Build P1 control plane craft (2026-07-13)

Branch `feat/build-p1-control-plane`:

- Glossary terms (Project / App / Deployment / Environment) in `lib/glossary.ts`.
- Empty states use one CTA (`EmptyState`) on Projects, Deployments, Overview, Operate.
- Global toasts for env save/delete and promote/deactivate.
- ⌘K command palette (+ header Search) for Projects, Deployments, Usage, Settings.
- Default `/` opens last project or `/projects`; Overview moved to `/overview`.
- Desktop-first surface bar locked: desktop best path; tablet unbroken; phone
  usable (Search icon always visible; full Search · ⌘K from `sm+`).

## Billing option A — payment methods on Chat (2026-07-13)

Branch `feat/billing-payment-methods-status`:

- Account → Billing teaches BYOK/Tempo are on the Chat account; Build lacks
  AccountBearer so we do not call `GET /api/account/payment`.
- Adds Open Chat link; keeps Usage + Secrets; no fake method status.
- Clarifies `accountScopedFetch` comment (auth not wired on Build).
- Documents auth blocker + option A/B in `BILLING-EXPERIENCE.md` Phase C.

## Billing experience — backend/UI map in plan doc (2026-07-13)

- Expanded `apps/build/BILLING-EXPERIENCE.md` with control/data plane
  mermaid, HTTP-vs-internal table, and Build UI now/should map (Cursor-style).

## Account → Secrets stay-on-settings (2026-07-13)

Branch `feat/settings-secrets-no-auto-redirect`:

- Single-project path no longer `router.replace`s to Environment.
- Account → Secrets stays put with teaching copy + **Open Environment** CTA.
- 0 / 2+ behaviors unchanged. Tests updated in `settings-secrets-panel.test.tsx`.

## Billing experience Phase A — settings sub-nav (2026-07-13)

Branch `feat/builders-billing-experience-phase-a` (PR #319):

- Added `SettingsNav`, `SettingsLayout`, and `settings/layout.tsx` so all
  `/settings` routes share Account sub-navigation driven by `settings-data.ts`.
- Overview + every section (including Soon stubs) is one click away; badges
  show Available / Project-scoped / Soon; Billing + Secrets panels unchanged.
- Test: `settings-nav.test.tsx`.

## Billing experience plan rename (2026-07-12)

- Renamed `apps/build/BILLING-CLARITY.md` → `BILLING-EXPERIENCE.md`
  (matches `BUILDERS-EXPERIENCE.md` naming). Content uses "Billing Experience";
  A→D phases and mental model unchanged.
- Local branch renamed to `feat/builders-billing-experience-phase-a`
  (was unpushed `feat/builders-billing-phase-a-clarity`).

## Overview read-path perf (2026-07-11, aomi-build)

Follow-up to the Codex performance review of PR #309 / product-mono#787 —
the initial Overview load path, which the first round left untouched:

- `useProjects` now consumes the shell-level `GitHubSessionProvider` instead
  of refetching `/auth/github/status` (one session round trip per page, not
  two).
- Overview renders its shell immediately once the session is known; project
  stats and the deployments card hydrate independently (no more full-page
  `Loading overview...` gate on the sources fetch).
- `useGlobalDeploymentRecords` fetches per-source `deploymentHistory()` (one
  call per source, DB-backed via the `deployments` projection after
  product-mono#787) instead of `deploymentRecords()` per app per source.
  Needs backend `created_at` in deployment JSON (added in #787 branch) for
  cross-source sorting; legacy records sort last at 0.
- Operate BFF `ownedSources` caches `listUserSources` per user+platform for
  15s with in-flight coalescing — concurrent operate widgets share one
  backend ownership lookup.
- NOT addressed (pre-existing, unrelated failures): `deploy-step.test.tsx` /
  `project-row.test.tsx` fail at the branch base; another session appears to
  be fixing them — left alone.
- Projection cold start (Codex point 5) needs no new code: both latest and
  history GitHub fallbacks already write back via `project_deployment`, so
  each legacy source pays GitHub once and is DB-served afterwards.

## Deploy control-plane plan (2026-07-10)

- Drafted `docs/topics/deploy-control-plane-plan.md`: phased plan to restore
  the "GitHub only behind the BE" invariant — Phase 1 BE rerun endpoint +
  delete `enrichPendingCiStatus`/`githubToken` from app and
  `@aomi-labs/deploy`; Phase 2 webhook-fed DB projection (kills per-poll
  GitHub fan-out and the manifest/DB dual source of truth); Phase 3 R2
  artifact store for release assets; Phase 4 extract a Rust control-plane bin
  (move, not copy). Decisions + rejected alternatives recorded in the doc.
- Working tree (`fix/deploy-flow-usability`, uncommitted): `commitMatches`
  redeploy stale-run fix, activation error surfacing, sign-out wizard-state
  reset, refresh latch fix, `settleBySource` operate fault tolerance.
  Verified: launch suite 32/32, typecheck, lint. Note: the package copy
  (`packages/deploy/src/bff/launch-routes.ts`) still has the pre-fix
  `?? runs[0]` stale-fail behavior — either port or accept until Phase 1
  deletes the function.
- Phases 0–2 of the plan are IMPLEMENTED and verified in working trees
  (uncommitted): Phase 1 backend (rerun endpoint, `CiOutcome.run_id`, run-URL
  deep link) + Phase 1 TS (enrich/`githubToken` deleted from aomi-build,
  portal AND `packages/deploy`; redeploy repointed via new
  `DeploymentClient.rerunDeployment()`; OpenAPI fixture + route manifests
  regenerated) + Phase 2 (github_ci_runs migration/entity, workflow_run
  webhook projection, projection-first `resolve_deploy_ci` with 30-min
  in-flight trust window + backfill, rerun marks row queued, release reads
  skipped while CI in flight). Verified: backend 195/195 + fmt + clippy;
  widget workspace 630 passed + typechecks. Phase 1 TS deletions subsume the
  Phase 0 `commitMatches` fix; the other four Phase 0 fixes are intact in
  this diff. Phases 3–4 intentionally blocked (see plan doc §5): Phase 4
  moves the files Phases 1–2 edited (land those first); Phase 3 needs an R2
  bucket + creds; both need the bin-name call.
- Operational follow-ups for Phase 2: run the new supabase migration;
  subscribe the GitHub App to `workflow_run` webhooks; grant the App
  `Actions: read + write`.
- Decisions locked (plan doc §6): control-plane bin = `aomi/bin/manager`;
  R2 provisioning agent-driven via wrangler; keep polling (no SSE);
  partner-scoped bearers as their own change before first partner onboards.
- 2026-07-10 later session: Phase 2 REDESIGNED per Cecilia — `github_ci_runs`
  replaced by a proper `deployments` projection table (full manifest JSONB +
  indexed columns + webhook-fed ci_* columns; write-through at deploy, lazy
  backfill on status reads, workflow_run webhook matching by repo+branch+
  commit-prefix). Phase 3 CODE done: `crates/artifact-store` (config-gated
  R2/SigV4 client) + cache-through in `AppFetcher::fetch`. NO live
  Cloudflare changes; R2 is not even enabled on the account yet (dashboard
  step, Cecilia). All verified: backend 195/195, database + runtime + crate
  tests, fmt, clippy. Pre-existing env failure: runtime
  `all_plugins_load_and_have_valid_manifests` fails on SDK 3.0.1 dylibs vs
  3.0.2 host (see teammate's `docs/plans/2026-07-10-sdk-bump-app-rebuild.md`).
- Phase 4 CODE done, then upgraded to a physical extraction (Cecilia's
  call): the deploy domain — `platforms/*` handlers, deploy-surface HTTP
  endpoints (+webhook), activation auth (`PlatformActivationToken`,
  `Activation`, `AuthorizationHeaderExt`), and the `github_app.*.toml`
  configs — now LIVES in the `manager` crate (`aomi/bin/manager`, lib+bin,
  edition 2021). Dependency arrow: backend → manager (never reverse);
  backend re-exports keep `crate::handler::platforms::*` /
  `crate::auth::Activation` paths alive for its remaining callers (runtime
  reconciler, runtime-coupled `apps` endpoints, AuthRouter). Endpoints are
  substate-typed (`State<PlatformHandler>`/`State<DbPool>`) so the same fns
  mount in both routers. `PlatformHandler::new(&SharedRuntime)` was dropped
  (backend constructs via `from_pool`), keeping manager runtime-free.
  Deploy workflow toml paths updated to `aomi/bin/manager/…` (repo file
  only). Tests: backend 135 + manager 60 = same 195, all green; fmt +
  clippy clean of new warnings. NO infra/live changes anywhere.
- Read-path perf fixes done + committed (commit 2 on seperate-github-proxy):
  card hydration (`user_source_latest_deployment`), history
  (`user_source_deployments`), and the `deployment_status` hot-poll window
  now serve from the `deployments` projection (record JSONB + webhook-fed
  CI); GitHub only on row-miss, with lazy write-back backfill. New
  `DbDeployment::list_for_source` + widened index in the unapplied
  migration. Projects/Overview page loads become GitHub-free once each
  source has one row.
- Next (Cecilia): review + land both repos' diffs; run the deployments
  migration; GitHub App settings (workflow_run webhook + Actions r/w);
  enable R2 in the Cloudflare dashboard → I provision bucket/token + env;
  infra cutover for manager (systemd unit + edge routes + webhook URL) when
  ready. Ops note: freed ~80GB by deleting product-mono cargo incremental
  cache (disk hit ENOSPC mid-build; cache regenerates).

## Staging account and environment fixes (2026-07-11)

2026-07-11 — Staging Para sign-in fix (PARA_JWT_AUDIENCE) + blank-env hardening

## Staging Para sign-in broken: aud mismatch (2026-07-11)

Para login on chat-staging.aomi.dev authenticated at Para (embedded wallets
connected) but never became an Aomi session: `POST /api/auth/aomi/provider/exchange`
400'd repeatedly with jose `unexpected "aud" claim value`. Para **PROD** session
JWTs carry the Para project UUID (`8c67b747-9c8f-416a-b4d4-067bb1209c9c`) as
`aud`, but the deployed stack had no `PARA_JWT_AUDIENCE`, so
`readAccountAuthEnv` fell back to `NEXT_PUBLIC_PARA_API_KEY` (`prod…` API key)
as the expected audience. UI symptoms of the same 400: the Para modal never
dismissed and /settings sat on "Connecting your account…".

- **Vercel env (chat-portal project):** three branch-scoped
  `PARA_JWT_AUDIENCE` Preview entries existed but were **empty strings**
  (placeholders). Replaced them with one project-wide entry per environment —
  Preview, Production, Development — set to the Para project UUID above (the
  `aud` observed in our own frontend's Para tokens, signature-verified against
  Para's PROD JWKS). Production previously had no audience configured at all
  and would have broken identically on its next deploy.
- **Redeployed** main (`chat-portal-5dbokzdxx`) so chat-staging picked the
  value up; verified the alias moved and that the exchange endpoint now fails
  a bogus token with a jose JWKS error instead of "Para JWKS verification is
  not configured" / an aud mismatch. Full E2E Para login still needs a human
  retry in the browser.
- **Code hardening (working tree):** `packages/account/src/better-auth/env.ts`
  now normalizes blank/whitespace env values to `undefined` (`nonEmpty`) for
  all optional Privy/Para fields — an empty `PARA_JWT_AUDIENCE=""` is not
  nullish, so it used to stop the `??` audience fallback chain and surface as
  the misleading "Para JWKS verification is not configured". Re-added the
  "prefers explicit Para JWT audience" test (lost in the packages/auth →
  packages/account fold) plus a blank-values regression test in
  `packages/account/test/env.test.ts`. 51/51 account tests green, tsc + eslint
  clean.
## Follow-ups from the same debugging session (2026-07-11, afternoon)

Para sign-in now completes on chat-staging (modal dismisses, wallets connect,
exchange 200s). Two residual breakages were root-caused; fixes are code-side
or handed off, per Cecilia's direction (no direct backend/DB mutation):

- **/settings "Couldn't connect your account" → backend `GET /api/account`
  500s for every user.** The deployed `product-mono/backend:main` image runs
  the app-billing usage query referencing `llm_usage_events.recipient`, but
  migration `supabase/migrations/20260708010000_llm_usage_events_recipient.sql`
  (additive: `ADD COLUMN IF NOT EXISTS recipient TEXT` + partial index) was
  never applied to the shared staging/prod DB. Backend log:
  `Failed to query usage range error=column e.recipient does not exist`.
  **Pending: apply that one migration** (owner's call — staging DB IS prod
  DB), then `/api/account` and the settings page recover.
- **`GET /api/updates` 404 spam → stale committed `packages/client/dist` on
  main.** `packages/client/src/sse.ts` already targets `/api/thread/updates`,
  but main's committed dist still requests `/api/updates`, and consumers
  resolve the package through dist. The rebuilt dist (uncommitted, verified
  stable across a fresh `pnpm --filter @aomi-labs/client build`) sits in the
  working tree ready to commit — that alone stops the 404s.
- **Legacy widget-auth account graph still in the DB.** `public.aomi_users`,
  `aomi_auth_identities`, `aomi_wallets`, `aomi_account_events` are orphaned
  (zero references in aomi-widget or product-mono `origin/main`; the live
  stack uses canonical `users`/`auth_providers`/`public_keys` + `ba_*`
  better-auth tables). Staged `scripts/drop-legacy-aomi-account-tables.sql`
  (pre-flight checks + RESTRICT drops, no CASCADE) for review; also fixed the
  last stale `aomi_wallets` comment in
  `apps/shadcn-registry/src/lib/wallet-kit/account/aomi-backend-runtime.ts`.
## Aomi Build owned operate + pre-prod fixes (2026-07-08)

- Hardened launch/operate-adjacent BFF reads and writes around the signed-in
  GitHub user's owned `app_source` rows: activate requires `appSourceId` plus
  app/release-tag pair ownership; app/status/records reads are session scoped;
  portal and the shared `@aomi-labs/deploy/bff` route factory follow the same
  contract.
- Added explicit error state for deployment history and environment secret
  loads so failed reads no longer collapse into empty UI. Deployment activity
  wording now uses "Activity" instead of "Logs" for promotion records.
- Replaced the static overview placeholder with a signed-in owned-app overview,
  added a project Chat tab using the existing chat deep-link contract, split
  environment variables by app, and made the deploy stepper's busy/current/done
  states explicit.
- Follow-up review fixes split the Environment tab into plain env vs masked
  secret sections, stopped the outer wizard stepper from spinning while waiting
  on input, tightened the wizard styling to the control-plane shape, removed the
  signed-in nav flash, and avoided simultaneous overview loading/empty states.
- Shared the Aomi Build GitHub session through a control-plane context, gated
  operate pages/navigation on that session, and renders the GitHub sign-in panel
  without calling protected BFF endpoints when signed out.
- Verified with focused Vitest suites for `aomi-build`, `portal`, and
  `packages/deploy`, plus `@aomi-labs/deploy` build and app typechecks.

## Flexible-orchestration roadmap (Cecilia's direction) — COMPLETE

2026-07-07 — aomi-smither: wait-external + cross-repo agents (stage 3) — roadmap complete

- **Stage 1 — composition + clarify** ✅. Plan is a composition of typed
  phases; clarify pauses answerable from TUI + console.
- **Stage 1.5 — intake in the browser from t=0** ✅. The composer is visible
  before the workflow exists; one tab follows into the build.
- **Stage 2 — multi-loop + eval + parallel** ✅. `eval` phase (run + judge →
  metric), `eval-pass` loops with graceful `return-last` max, parallel fan-out.
  Proven on the defi-pools shape.
- **Stage 3 — wait-external + cross-repo agents** ✅ (this entry). Durable
  external pauses; agent phases in other repos. Proven on the GameFi shape.

## Recent Changes

### wait-external + cross-repo agents (2026-07-07, stage 3)

The last two primitives — for full-stack / outside-Aomi work (the GameFi
scenario):

- **plan.ts** — `wait-external` phase (waitingFor / timeoutHours / onTimeout);
  agent phases gained `repo` (run in another codebase); new `design` role
  (writes DESIGN.md for a human to build the other side from). `agentSpecsFor`
  is a pure export listing the distinct (agent, cwd) pairs the workflow
  instantiates — so cross-repo wiring is testable without running an agent.
- **schemas.ts** — `external` table doubles as the wait-external signal payload
  ({ ready, note, receivedBy }) and its output row.
- **workflow.tsx** — renders `wait-external` as a Smithers `<Signal>` keyed by
  the phase node id (schema = the registered `external` table); done when its
  row lands. Agents instantiated one-per-(agent, repo).
- **run.ts** — `sendSignal` (wraps engine `signalRun`); `executeRunUntilSettled`
  now also resumes on `waiting-event`, not just `waiting-approval`.
- **console.ts / cli.tsx** — console side channel gained `POST /signal`; new
  `aomi-smither signal --app <app> --node <phase>` subcommand. Composer intake
  prompt teaches wait-external + cross-repo + the full-stack shape.

Grounding first: an empirical `<Signal>` probe established the contract —
signalName === the Signal node id, the Signal's schema must be registered in
createSmithers, and the parked status is **`waiting-event`** (NOT
waiting-approval — that gap would have hung the settle loop; fixed).

Verified live through the real runtime, CROSS-PROCESS (the true durability
claim): process A parked a run on wait-external (`waiting-event`); process B —
the *built* `aomi-smither signal` CLI — delivered the signal by loading the
run off disk; process C resumed (`resuming? true`) and finished, with the
`external` row carrying the note from process B. Plus an in-process GameFi
proof: binaries → wait-external (park → signal → resume) → eval-loop (0.9 pass)
→ result complete. 73 vitest green (4 new: GameFi shape, wait-external stage,
cross-repo cwd separation, same-repo agent dedup); tsc + eslint clean; dist
rebuilt.

Known gap (noted, not blocking): the branded browser console shows a
wait-external node as a rail row but has no in-page "signal ready" button yet
— resume it from the CLI or a `POST /signal`. A button is UI polish for a
follow-up.

### Multi-loop + eval + parallel (2026-07-07, stage 2)

Extended the composition vocabulary with the three primitives the arb-bot /
GameFi / defi-pools scenarios jointly demanded:

- **plan.ts** — `eval` phase (scenario/rubric/threshold/judge), `parallel`
  phase (branches[][], maxConcurrency), and loops generalized: `until` is
  "validation-green" | "eval-pass"; `onMax` "fail" | "return-last"; agent
  `onlyIf` gained "prev-eval-fail". `innerPhasesOf` centralizes the descent
  into loop bodies + parallel branches; `compositionIssues` validates the new
  shapes (eval needs binaries; eval-pass loop needs an eval in body; ids unique
  across branches). `stagesFor` expands a parallel into a header row + one row
  per branch leaf (each lights up independently); loops stay one row.
- **evals.ts** (new) — `runEvalStep`: compile → aomi-run(scenario) →
  read-only judge (claude/codex → strict JSON score) → EvaluationRow. Judge
  never edits files. Malformed score clamps to 0 (a failing eval, not a crash).
- **workflow.tsx** — renders `<Parallel>` (branch = `<Sequence>`) and eval
  Tasks; eval-pass loops use the latest eval's `pass` as the `until` predicate;
  refine agents get the judge's feedback folded into their prompt. `loopDone`
  detects graceful `return-last` max via `ctx.iterations` (0-indexed → final
  round is maxRounds-1; the enclosing Sequence still orders downstream).
- **prompts.ts** — composer intake prompt teaches the eval/parallel/loop
  vocabulary; `judgePrompt` + `PromptContext.evalFeedback`.

Verified live through the real Smithers runtime (stubbed commands): (1) parallel
fan-out — both branches ran concurrently and the run waited; (2) eval-pass loop
— judge scored 0.3 then 0.9 across iterations 0/1, loop exited on pass; (3)
graceful return-last — judge always 0.2, loop ran its 2-round budget, never
passed, and the result phase STILL mounted (status complete) instead of
hard-failing. 69 vitest green (10 new: composition shapes + eval judge + clamp +
failure paths); tsc + eslint clean; dist rebuilt.

Bug found + fixed during the proof: `return-last` max detection was off by one
(`ctx.iterations` is the 0-indexed current round, maxing at maxRounds-1), so
the result phase never mounted after a graceful loop. Fixed and re-proven.

### Intake visible in browser from t=0 (2026-07-06, stage 1.5)

Cecilia's ask after driving the morpho chat: "why stare at the terminal during
'thinking…' — give me a UI that monitors from the start." The composer isn't a
Smithers node (no graph until the plan is composed), so it can't ride the
gateway. Instead:

- **intake.ts** — `startIntakeServer`: a loopback HTTP server booted at CLI
  startup serving a self-contained aomi-branded page (`GET /`) + live state
  (`GET /intake`, polled). Shows the conversation, composer thinking (elapsed),
  the draft plan forming, and the composed stage preview. When the build
  starts it flips to `phase:"building"` with a `buildUrl` and the page follows
  itself to the gateway console — one tab across intake → compose → build.
- **cli.tsx** — `SmitherApp` boots the intake server at t=0 (prints
  `⌗ intake view:`), mirrors chat state (turns/draft/thinking/composed stages/
  phase) into it every change, and hands the console URL back from `RunView`
  via `onConsoleUrl` so the page follows on run start. `--no-console` disables.

Verified: intake server serves the page, reflects turns/thinking/draft/stages,
transitions intake→preview→building with buildUrl, and picks the next free
port on conflict (3 vitest). Live screenshot of the morpho preview state
(conversation + forming plan + composed clarify→research→synthesize→loop rail)
captured via playwright. 59 vitest green total; tsc + eslint clean; dist built.

Seam (honest): the transition is a redirect (intake server on 7331, gateway on
7332), not an in-place swap — one tab, one brief navigation. The composer is
streamed, not itself a durable node; making intent a true workflow node is the
stage-2+ "conversational orchestrator" direction and is noted, not built.

### Composition model + clarify primitive (2026-07-06, stage 1)

### Composition model + clarify primitive (2026-07-06, stage 1)

Cecilia's direction after reviewing three scenarios (arb bot, GameFi
companion, spec-less DeFi pools): the plan is now a **composition of typed
phases**, not flags on one pipeline. Stage 1 of 3 (next: multi-loop + eval +
parallel for defi-pools; then wait-external + cross-repo for GameFi).

- **plan.ts** — phase vocabulary (compute ops / agent roles incl. research,
  draft-spec, synthesize / clarify / gate / loop) as zod discriminated
  unions; `BuildPlan.phases?` optional; `classicComposition` reproduces the
  old pipeline with identical node ids (resume-safe); `compositionIssues`
  validates structure at finalize.
- **workflow.tsx** — generic renderer: walks `resolveComposition(plan)`,
  chain-mounts phases as predecessors' rows appear; denied gate skips
  downstream except result. Clarify = select-mode `<Approval>` with options
  mirrored into request.metadata; clarify answers are folded into later
  agent prompts (`PromptContext.clarifications`).
- **run.ts** — `executeRunUntilSettled`: the engine RETURNS
  `waiting-approval` (does not block) — discovered live; the settle loop
  re-executes with resume after durable decisions from any surface.
  `decideApproval` gained `selection` (approveNode's 7th arg).
- **console.ts** — loopback decision endpoint (`POST /decide`, port 0)
  beside the gateway: the stock 0.26.1 gateway approve route DROPS decision
  payloads (`approveNode(..., body.note, body.decidedBy)` — no decision
  arg), so browser select-mode decisions need this side channel. decideUrl
  rides into UI boot props; `ConsoleHandle.decideUrl` exposed.
- **cli.tsx / ui/aomi-smither.tsx** — TUI renders clarify options as a
  Select; branded console renders option buttons (first = recommended) and
  posts to the decision endpoint. Intake prompt teaches the composer the
  vocabulary + viability probe.

Verified live: (1) morpho intake — "build a morpho pool manager" →
ready:false, explains GraphQL-only, offers research-mode (recommended) /
draft-spec, asks positions-vs-vault-curation; (2) engine proof — composed
clarify workflow paused (ApprovalRequested → NodeWaitingApproval), decision
POSTed over the endpoint, "approval granted", resumed, finished;
`clarify` row persisted `{selected: "research-mode", notes}`; (3) browser
page serves options + decideUrl in boot props. 56 vitest green (5 new
composition tests), tsc + eslint clean, dist rebuilt.

Note for reviewers: headless `--yes` auto-selects each clarify's FIRST
option — compositions should order options recommendation-first.

### aomi-smither engine rewrite: Smithers-native, compose-from-intent (2026-07-05)
2026-07-03 - Tri-repo pre-merge review (aomi vs origin/main, product-mono vs origin/refactor/dbthread-unification, db-master). Local checks all green. Blockers logged below.

## Partner deploy primitives — additive on Han's main (2026-07-07)

Branch `partner-deploy-additive` (off `origin/main` `bf890120`, which merged Han's
#292 deployment-SDK-guardrails **including** his portal deployment console — codex
did NOT strip it; it is present + mounted at `/deployments`). Rather than the
earlier plan of gutting the portal launch feature into packages (which would have
collided head-on with Han's now-live console), this ships the partner-facing
primitives **purely additively** — 24 files, all under `packages/deploy/`, zero
changes to `apps/portal` or `apps/shadcn-registry`:

- **`@aomi-labs/deploy/bff`** (server-only) — framework-agnostic `(Request) =>
  Response` route factories: `createLaunchRoutes`, `createGitHubAuthRoutes`,
  `createGitHubSessionCodec`, default guards, config, validators, error mapper.
- **`@aomi-labs/deploy/launch`** (browser) — `createLaunchClient` typed client +
  wizard state machine + contracts + url-context.
- **`packages/deploy/skills/aomi-deploy/SKILL.md`** — agent-paste-able integration
  guide; ships with npm (`files` includes `skills`). Points partners at Han's
  portal console (`apps/portal/src/features/launch/`) as the worked example to
  read, not vendor.
- **`package.json`** 0.1.1 → 0.2.0 (adds `./bff` + `./launch` exports, `jose` dep,
  `skills` to files); `tsup.config.ts` adds the two entries.

Inherits Han's new SDK methods (`deactivateApp`/`promote`/`listSecrets`/
`listDeploymentRecords`/`serverTags`) from `packages/deploy/src/client.ts` with no
conflict (his additions were to files this extraction never touches). Build (4
entries) + 98 pkg tests green. **Superseded decisions:** the registry `aomi-launch`
shadcn item and the portal-as-thin-consumer rewrite are dropped — Han's console is
the portal's deploy UI + the reference; my registry component copies (old branch
`partner-deploy-readiness`, kept as backup) are redundant and not carried forward.
Deferred (not done): browser-exposed "stop"/deactivate in `createLaunchClient`;
publishing 0.2.0; unifying the portal's own launch routes onto these factories.

## Pending (from 2026-07-03 pre-merge review)

- BLOCKER: re-resolve merge of `packages/react/src/contexts/control-context.tsx` — merge commit 59cebe8e restored the pre-refactor monolith, clobbering main's composition root (`packages/react/src/control/*` now dead) and dropping `AomiPlatformFilter`/`applicationId` props main still passes.
- BLOCKER: `/api/mcp/[transport]` is unauthenticated and trusts `x-aomi-user`; gate or session-auth before deploy.
- BLOCKER: device-auth grant store is an in-process Map (`apps/portal/src/lib/device-auth-grants.ts`) — breaks on Vercel; move to Postgres.
- BLOCKER: client `/api/control/provider-keys` calls 404 vs new backend (BYOK moved to `/api/account/payment/byok`).
- HIGH: `packages/account/src/proxy.ts` fails open (mint failure → anonymous forward); apps/base forked its own anonymous proxy; committed `packages/{client,react}/dist` bundles; `scripts/smoke-auth-stack.mjs` targets deleted `/api/bff/auth/*` routes; portal next.config lost prod backend-URL fallback.
- Cross-repo: `signing_authorization` migration has no frontend counterpart; `aomi_wallets` vs backend `identity_wallets` never sync; db-master's 48 migrations are uncommitted and `rename_sessions_to_threads` is fresh-DB-only (staging/prod variant needed).
- Docs to prune before PR: AUTH-STACK-REVIEW.md, MERGE-BFF-BETTERAUTH-FIXES.md, WALLET-KIT-{CLEANUP,PR-WALKTHROUGH}.md, mcp-design.md; fix `apps/registry/` refs in DOMAIN.md/METADATA.md/repowiki.toml; prune this file's diary.

## Recent Changes

### Working trace: windowed view with animated expand/collapse (2026-07-07)

Branch `feat/working-trace-a`. A long turn's trace marched down the whole screen.
The open trace (live or after completion) is now **capped to a scrolling window**
(~5 steps / `WORKING_WINDOW_PX = 260`): newest steps stay pinned at the bottom via
flex `justify-end`, older ones clip and dissolve under a top mask. A "Show all N
steps" pill lifts the cap; "Collapse to recent steps" restores it. Both directions
tween the window height with the **Web Animations API** (`WINDOW_ANIM_MS = 300`,
ease-out), which — unlike a CSS transition — animates cleanly to/from the uncapped
`auto` height in both directions. Entirely presentational — no
runtime/merge/interpreter changes. The pill uses a horizontal-ellipsis marker (not
a chevron) so its glyph doesn't point at the header's open-chevron above it.

- `apps/shadcn-registry/src/components/assistant-ui/working-trace.tsx`
  (`WorkingTrace`): `expanded`/`overflowing`/`animating` state + `viewportRef`/
  `bodyRef`; a `windowed = !expanded` viewport with `maxHeight`/`overflow-hidden`
  and flex-end pinning; an effect measuring overflow (`bodyRef` natural height vs
  the cap); a layout effect that runs a WAAP `max-height` tween when `expanded`
  flips (skipped under reduced motion); the "Show all N steps" /
  "Collapse to recent steps" pill.
- `apps/shadcn-registry/src/themes/default.css`: new `.aui-working-trace-windowed`
  rule — a `mask-image` gradient fading the top 60px (applied only while content
  overflows and not mid-tween, so short traces are never faded).
- Verified: file typecheck (only pre-existing unrelated wallet-kit test errors)
  and eslint green. `packages/react/dist` rebuilt to sync the earlier
  `SUBMITTING_TO_WORKING_GRACE_MS` source change (650→300). Live streaming path
  (needs a real multi-tool agent turn) exercised in the user's environment.

### Working trace: paced/staggered reveal (2026-07-07)

Branch `feat/working-trace-a`. The Working trace looked "aggressive" — a burst of
2-4 tool calls flashed in together and chips popped all at once, because tool
steps arrive already-complete and a burst lands in one `messages` event, so React
committed every `WorkingStep` in a single frame. Fix is entirely in
`apps/shadcn-registry/src/components/assistant-ui/working-trace.tsx` +
a shimmer tweak in `src/themes/default.css` (no backend/runtime change):

- New `useStaggeredReveal(target, running)` hook reveals trace items one at a
  time. Adaptive cadence (1200ms base, tightening to ~360ms as backlog grows) so a
  model running ahead is caught up fast and in order; a ~220ms tail drain once the
  turn ends so the final answer is never gated on the stagger. Respects
  `prefers-reduced-motion`.
- Hook lifted into `AssistantTurnParts`; the answer now reveals only after the
  trace fully catches up. The newest revealed step shimmers as "live" (frontier
  follows the reveal); auto-collapse waits for full reveal + a 500ms grace.
- Chips fan in left-to-right via CSS `animationDelay` (100 + i·70ms) with
  `fill-mode-both`. Shimmer slowed to `3.8s ease-in-out`.
- Entrance animations play once: an `animatedCount` ref in `WorkingTrace` (survives
  the body's collapse/remount) gates each item's animate class on first reveal, so
  reopening a finished trace shows steps/chips static.
- Pacing only applies to a turn that's live at mount (`useStaggeredReveal` seeds
  `revealed = target` when not running), so a reloaded/scrollback/completed turn
  reveals everything at once and the answer never sits behind a replayed animation.
- Collapse is animated (grid-rows 1fr→0fr + opacity over 300ms, body stays
  mounted) instead of snapping shut. The final answer fake-streams via a ~500ms
  ease-out synthetic typewriter (`FakeStreamedText`); both the fake-stream and the
  entrance are gated on `liveTurn` (a `liveTurnRef` in `AssistantTurnParts`) so a
  loaded/completed turn renders the answer in full with no replay.
- Plain replies (no tool calls) buffer while the turn is still running, because
  text before the first tool call is provisional and may move into the Working
  trace if a tool arrives later. If no tool arrives, the settled final answer
  fake-streams through `FakeStreamedText` after completion, matching post-tool
  answer behavior without the pre-tool text jumping.
- Runtime turn merging only folds assistant runs that contain tool-call parts.
  Contiguous text-only assistant fragments are treated as backend streaming
  snapshots and collapse to the latest fragment, preventing duplicate replies
  such as `...?Hey — ...` from being glued into one final bubble.
- Text finalization also conservatively collapses a single text fragment that
  already contains the same answer twice back-to-back, records
  `control.lastCompletedAt` when a turn settles so late-mounted answers can
  fake-stream, and keeps final-answer text normalization in the runtime instead
  of duplicating fuzzy UI-side cleanup.
- The generated assistant-thread registry payload and landing `/r` mirror were
  refreshed so installed/served widgets get the same final-answer reveal branch.
- Verified: focused React runtime/chat Vitest coverage, targeted ESLint, React
  package build, widget registry build, and generated assistant-thread payload
  guards with pinned `pnpm@10.28.0`. Not yet eyeballed on a live tool-calling
  turn (needs backend + funded wallet).

### Auth docs cleanup pass (2026-07-02)

Branch `codex/merge-bff-betterauth`. Consolidated the stale root
`HANDOFF-LOCAL-BACKEND.md` and `docs/local-merged-bff-betterauth-stack.md` into
`docs/local-dev-stack.md`, removing the old `bff-unification` worktree and HS256
`aomi_session` local-stack story. Refreshed `specs/WIDGET-AUTH-PLAN.md` so the
surviving auth plan describes the live BetterAuth session -> BFF AccountBearer
architecture instead of deleted BetterAuth backend JWT/JWKS or legacy provider
exchange paths. Updated auth fact docs, docs indexes, repowiki globs, and
generated UserState references to point at the live `wallet-kit` / `aomi-account`
paths. The §13-A schema rename and provider-provenance FK work remains deferred.

### Portal client-token-provider dead-weight cleanup (2026-07-01)

Branch `codex/merge-bff-betterauth`. Follow-up to the thread-list race fix. The
portal wired a client-side `createAccountAccessTokenProvider` into **5**
components (widget + `general-settings`/`bots`/`apps-settings`/`app-keys`) that
minted an `Authorization: Bearer` header — but in same-origin proxy mode
(`NEXT_PUBLIC_BACKEND_URL=/`, the shipped default) the BFF proxy mints the bearer
server-side from the `better-auth.session_token` cookie and strips that header, so the whole
machine was dead weight (latency + `/v1/account/bearer` 401 spam + a duplicate
`providerExchange` owner).

- **Not deleted outright — made conditional.** It is still load-bearing in
  direct-to-backend mode (browser talks cross-origin to the Rust backend), so a
  blind delete would have broken that path. New helper
  `apps/portal/src/lib/account-access-token.ts`
  (`createPortalAccountAccessTokenProvider`) returns `null` in same-origin /
  SSR and only builds a real provider when `getBackendUrl()` is cross-origin.
  This also collapsed the ~30 duplicated lines across the 5 components into one
  call. The shared `@aomi-labs/client` `createAccountAccessTokenProvider` +
  `@aomi-labs/account` `createBearerTokenRoute` (`/v1/account/bearer`) are kept
  intact as the documented direct-to-backend seam (used by out-of-repo
  base/landing and the CLI-less direct path).
- **User decision:** deployment topology was "not sure — play it safe", so the
  conditional (no regression either way) was chosen over a hard delete.
- **Verified.** `typecheck:portal` + eslint clean; `packages/client` +
  `packages/account` auth suites green (36); full `scripts/smoke-auth-stack.mjs`
  with `AOMI_SMOKE_SIWE=1` against the live local stack passed every row (SIWE
  sign-in, bearer claims `kid=aomi-bff-dev-1 iss=aomi-bff aud=aomi-backend`,
  direct-backend bearer path, same-origin proxy path, thread/app-key/chat,
  cross-wallet account linking). Real `aomi` CLI e2e (isolated `AOMI_STATE_DIR`)
  passed: `account login` (SIWE) → `whoami` → `wallet whoami` → `chat` ("pong")
  → `logout` → post-logout 401. Browser manual testing left to the user.
- **Pre-existing nit (not touched):** `aomi account whoami` throws a raw stack
  trace on a 401 instead of printing "not signed in".

### Thread list "needs a refresh on login" fix (2026-07-01)

Branch `codex/merge-bff-betterauth`. On a fresh login the thread list did not
load until a manual page refresh.

- **Root cause:** the thread-list effect in
  `packages/react/src/runtime/user-state-provider.tsx` fires when `isConnected`
  flips true, but `isConnected` is forwarded from wallet _connection_
  (`apps/registry/.../wallet-kit/context.tsx` -> `identity.isConnected`), which
  lands before the SIWE/provider sign-in writes the BetterAuth `better-auth.session_token`
  cookie. On the portal every `/api/*` call is same-origin through the BFF proxy
  (`packages/account/src/proxy.ts`), which authorizes purely from that cookie
  (`injectBearer` -> `getSessionedCanonicalId`) and **ignores the browser's
  `Authorization` header** entirely. So `GET /api/sessions` 401s until the
  cookie exists. The old `listThreadsWithAuthRetry` retried only 3× over ~2.5s
  (`[250, 750, 1500]`) then gave up permanently with no re-trigger; signing a
  SIWE message routinely outlasts 2.5s, so the list stayed stranded until a
  refresh (by which point the cookie is already on disk).
- **Fix:** replaced the fixed 3-step ladder with a bounded, capped exponential
  backoff (base 300ms, ×1.7, cap 2000ms, 30s budget) that keeps retrying 401s
  while the user stays connected. Cancellation is unchanged (the effect still
  sets `cancelled` on disconnect/unmount, and `isCancelled()`/non-401/budget
  each break the loop). Threads now appear within ~2s of the cookie landing.
- **Tests:** `packages/react/src/runtime/__tests__/thread.test.tsx` gained
  "keeps retrying past the old fixed cap while the sign-in cookie lands" (4×401
  then success -> 5 calls, impossible under the old cap) and "stops retrying
  non-auth thread list failures" (a 500 fails fast, 1 call). Full react runtime
  suite green (24 thread + 45 user/thread), tsc + eslint clean, `@aomi-labs/react`
  rebuilt so the portal consumes the fix.
- **Tech debt surfaced (not fixed here, flagged for follow-up):** (1) the portal
  wires a full client-side account-bearer provider
  (`packages/client/src/account-session.ts`, `createAccountAccessTokenProvider`
  in `portal-aomi-frame.tsx`) whose `Authorization` header the proxy discards —
  dead weight on the portal (only a direct-to-backend client like the CLI needs
  it), plus a second `providerExchange` owner alongside the wallet-kit account
  runtime; (2) `is_connected` conflates "wallet connected" with "backend
  authenticated," so the widget has no true "session cookie live" signal to key
  loading off; (3) the token provider's `subscribe` does not fire on the first
  successful mint (`previous === null`), so the SSE reconnect hook misses the
  initial auth-ready moment.

### Merge BFF + BetterAuth cleanup (2026-07-01)

Branch `codex/merge-bff-betterauth`. Current auth path is BetterAuth session
cookie or bearer-plugin token -> portal proxy session resolution -> canonical
Aomi `users.id` -> EdDSA `AccountBearer` minted through the static service
topology -> backend verification. The deleted BetterAuth JWT/JWKS minter and
legacy auth-mode switch are no longer part of the contract.

- CLI BetterAuth SIWE login is wired and verified for login, `wallet whoami`,
  chat, session list/status, state fetch, and logout against the local stack.
  The only remaining CLI parity row is the browser-wallet comparison proving
  the same wallet resolves to the same `users.id` in GUI and CLI.
- Rotated the dev BFF key and aligned the portal topology data with the
  neighboring backend `service.toml` / `service.dev.toml`.
- Cleaned the stale docs/scratch surface: the old JWT contract and merge plan
  were deleted, `tmp.md` became the generated user-state shape reference, and
  dead scratch files were removed.
- `origin/main` reconciliation remains intentionally deferred for the PR author;
  do not treat this branch as rebased onto the BFF-unification changes.

### Coinbase Smart Wallet SIWE hang + Postgres deadlock (2026-06-30)

Branch `codex/merge-bff-betterauth`. Two server-side bugs surfaced when signing in
with Coinbase Wallet (EOA wallets like MetaMask/Rabby were unaffected):

- **SIWE sign-in spun forever for Coinbase.** Coinbase Wallet is a Smart Wallet
  (WebAuthn/passkey, ERC-6492-wrapped signature), so the EOA `ecrecover` path
  rejects it (`invalid signature length`) and verification falls through to the
  on-chain EIP-1271/6492 check. That `verifyMessage` ran a heavy deployless
  `eth_call` against viem's keyless default mainnet RPC (`eth.merkle.io`), which
  timed out (`The request took too long to respond`). With no tight timeout in
  the client fetch, the landing proxy, or the public client, the sign-in spinner
  hung. Fix: `packages/auth/src/better-auth/siwe.ts` (and twin
  `packages/account/src/siwe.ts`) now read a per-chain RPC env override
  (`MAINNET_RPC_URL`/`ETH_RPC_URL`, `BASE_RPC_URL`, etc.) and use
  `http(url, { timeout: 10_000, retryCount: 1 })`. **Requires** setting a real
  EVM RPC (e.g. `MAINNET_RPC_URL`) in `apps/portal/.env.local` for verification
  to actually succeed; otherwise it just fails fast instead of hanging.
- **Postgres `deadlock detected` (×24 in one session).** `ensureAccountSchema()`
  ran the full `schema.sql` (including `alter table … drop constraint` →
  AccessExclusiveLock) on the request path, gating getOrCreate / link / delete.
  Concurrent requests deadlocked the DDL against row writes on
  aomi_users/aomi_auth_identities/aomi_wallets. Fix:
  `packages/auth/src/service/account-service.ts` memoizes `ensureAccountSchema`
  so the DDL applies at most once per process (failure clears the cache to allow
  retry). The dev-auth-stack script already applies the schema at startup.

### Wallet auth bug fixes: quick sign-in de-dupe + SIWE unlink detachment (2026-06-19)

- Quick sign-in now prefers the provider-level Privy/Para auth row and suppresses
  stored embedded wallet authenticate rows for that same provider. This removes
  the duplicate "Privy" row where one row showed the provider method and another
  showed the stored SVM address.
- Manage wallets now folds stored provider wallets into the connected provider
  row for display, so a live Privy SVM connection plus stored Privy EVM wallet
  renders as one `EVM/SVM` row. Actions still target only live wallet legs.
- SIWE/link signature verification now tries EOA recovery first, then Viem
  public-client verification for contract accounts (ERC-1271 / EIP-6492), fixing
  Base Account signatures that previously returned `invalid_wallet_signature`.
- The portal dev auth E2E page no longer nests its own wallet provider inside the
  root `WalletProviders`, avoiding duplicate Privy provider instances.
- SIWE wallet unlink now detaches BetterAuth state for that wallet address, not
  just the Aomi `aomi_wallets` row: matching BetterAuth `walletAddress` and
  `account(providerId='siwe')` rows are deleted, matching Aomi
  `better_auth` identities are revoked, `aomi_users.better_auth_user_id` is
  cleared if it pointed at the detached BetterAuth user, and SIWE-only synthetic
  BetterAuth users/sessions are removed. This prevents an unlinked MetaMask/SIWE
  wallet from logging back into the old account.
- Regression coverage: `wallet-picker.test.tsx` asserts the duplicate Privy
  quick-sign-in row is suppressed. SQL cleanup was validated against local
  Postgres in a rollback-only transaction with fake SIWE rows.

### Wallet-kit: removed the account `signInPolicy` gate (2026-06-19)

Branch `codex/widget-auth-pre-rust`. Stripped the
`signInPolicy` (`evm-siwe-first | provider-token-allowed`) concept from the
account layer — any provider credential is now exchangeable in any order (create
when there's no account, link when one exists); SIWE was already ungated.

- `aomi-backend-runtime.ts`: dropped `signInPolicy` from
  `AomiBackendAccountConfig` + the hook input + effect deps; the exchange
  endpoint no longer branches on a policy (`account.user` → link via
  `/v1/account/provider/exchange`, else create via
  `/api/auth/aomi/provider/exchange`).
- Removed `signInPolicy` from `config/types.ts` `AccountConfig` and from all
  three runtime call sites (`AomiWalletKitProvider`, `ParaPluginProvider`,
  `PrivyPluginProvider`) and the portal dev-e2e route.
- Follow-up fix: explicit sign-out now clears prior provider exchange locks and
  suppresses only the exact stale provider credential observed during sign-out
  until the SDK reports unauthenticated or changes identity. This keeps auth
  policy-free while preventing an old Privy/Para SDK session from silently
  recreating the just-signed-out account.
- Follow-up fix: rejected/failed automatic SIWE no longer poisons account
  `status` to `error`; it suppresses repeat prompts for that wallet and leaves
  provider-token sign-in free to proceed.
- Follow-up fix: provider-supplied `Sign out` rows in the wallet picker now call
  the full account sign-out path (`disconnect({ family: "all" })` +
  `account.signOut`) instead of only disconnecting the provider row.
- Dev E2E harness fix: `linkSecondTestWallet` now fetches the link nonce, signs
  a message containing it, and posts the nonce back to `/v1/account/wallets/link`.

### Account manager: collapse Privy/Para EVM+SVM into one row (2026-06-19)

Branch `codex/widget-auth-pre-rust`. UI cleanup of the "Manage account" panel
(`apps/registry/src/components/control-bar/wallet-picker.tsx`) so a
provider-backed sign-in no longer shows as two cards per family.

- **New pure helpers + `FamilyChip`** (module scope, easy to test): `WalletLeg`,
  `sortLegs` (EVM before SVM), `joinLegAddresses`, `singleNetworkName`,
  `buildConnectedEntries`, `buildAccountAccessEntries`, `connectedLinkState`.
  `FamilyChip` renders one dot+label per family and the combined **"EVM/SVM"**
  label when a row carries both (capability dot: amber = read, emerald =
  write/connected).
- **Connected now:** `buildConnectedEntries` groups the live `walletModalRows`
  by `provider` — Privy/Para fold into one "Privy"/"Para" row whose subtitle is
  `evmAddr / svmAddr · <network?> · <linkState>`. External wallets (no provider)
  stay one row each. `ConnectedWalletSummaryRow` now takes a consolidated
  `entry` instead of a single `WalletModalRow`.
- **Account access:** `buildAccountAccessEntries` merges each provider auth
  identity with the wallets sharing its `provider` into one canonical row
  (sign-in + EVM/SVM addresses), instead of one session row + two wallet rows.
  Provider-less identities (Google) and SIWE/observed external wallets stay
  standalone. `LinkedAuthAccountRow` gained optional `wallets`/`supportedEvmChains`
  and renders the `FamilyChip` + address subtitle when wallets are folded in;
  rename/unlink still target the auth identity.
- **Manage wallets (interactive switcher):** same provider grouping applied to
  the front-panel "Connected" list. `groupConnectedByProvider` folds Privy/Para's
  EVM + SVM into one row; `FamilyStatusRow` was replaced by `ConnectedWalletRow`
  which takes `legs` + a deduped `ConnectedActionRef[]` (each action routed to its
  owning leg). Select targets the non-active EVM leg; a provider's two `signout`
  actions collapse to one full account sign-out. External wallets (no provider) are
  unchanged, one row each.
- **FamilyChip:** one capability dot (not one per family) before the combined
  "EVM/SVM" — the legs are always connected together, so two dots read as noise.
  Dot is amber only when every leg is read-only, else emerald.
- **Regression fix (provider grouping):** the first grouping pass keyed/titled on
  any non-empty `provider`, so a SIWE-verified MetaMask (`provider: "siwe"`)
  rendered as a "siwe" row. Added `isEmbeddedAccountProvider` (privy/para/
  baseAccount only) and gated `buildConnectedEntries`, `groupConnectedByProvider`,
  and `buildAccountAccessEntries` on it — `siwe`/`siws`/`observed`/etc. are
  verification methods, not wallet brands, so those rows keep their own name and
  never group. Test: "keeps a SIWE-verified external wallet's own brand, not
  'siwe'". Suite 31 green.
- **Bug fix (default link label):** `linkWallet` in
  `account/aomi-backend-runtime.ts` derived the first-link label from
  `activeEvmConnection.walletName` — the _active_ EVM signer — so linking
  MetaMask while a Privy smart wallet was active produced "Privy Smart Wallet 1".
  Extracted `resolveLinkedWalletName` (match the live EVM account by `accountId`,
  then `address`; fall back to the active connection only when absent) and named
  the label after the wallet actually being linked. Note: persisted labels keep
  via `coalesce`, so already-mislabeled rows need a manual rename; the fix is
  forward-looking. New `aomi-backend-runtime.test.ts` (6 tests) covers the
  resolver + `buildDefaultWalletLabel`. Artifact: surgically patched only
  `aomi-backend-runtime.ts` inside `aomi-wallet-kit.json` (left the file's
  pre-existing `types.ts`/`brands.ts` drift untouched; `dist/aomi-wallet-kit.json`
  is gitignored).
- **Tests:** added "collapses a provider's EVM + SVM into one row in both
  sections" (now asserts 3 consolidated chips: Manage wallets + Connected now +
  Account access) and "collapses a provider's wallets into one row in Manage
  wallets" to `wallet-picker.test.tsx`. Suite 30 green. Also green: wallet-kit +
  control-bar suites (152), `apps/registry` tsc, lint, `build:lib`, pinned
  registry-artifact test. Rebuilt registry + synced **only** `control-bar.json`
  (the artifact embedding `wallet-picker.tsx`); reverted unrelated pre-existing
  drift in the para/privy/wallet-kit provider JSONs.
- **Pre-existing, NOT from this change:** `typecheck:landing` reports 3 errors
  (`WalletsConfig.embedded` in `landing-wallet-kit-provider.tsx` +
  `para-solana-runtime-driver.tsx`, and a generated `.next` `chat-ui-lab/page.js`
  type) — confirmed present with this change stashed.
- **Not eyeballed live:** the merged Privy/Para state needs a real provider
  session, so it's verified via the component test rather than the browser.

### Widget auth plan — full rewrite + 48 locked decisions + merge model (2026-06-17)

Branch `polish-multi-wallet`. No code — extended the earlier review into a
complete decision sweep (48 questions via the question tool) and a focused
investigation of the one open risk (account clustering/merging), then **rewrote
`specs/WIDGET-AUTH-PLAN.md` from scratch** in an agent-followable style (mermaid
diagrams, ERD, structs, phase checklists). All decisions are in the plan's §16
Decisions log + the [[widget-auth-plan-decisions]] memory. Headlines:

- **Scope:** full `aomi_*` core schema (users/identities/wallets) **+**
  `aomi_account_events`; drop proofs + challenges. Provider-token sessions IN v1.
  Keep + expand the existing account UI.
- **Identity:** separate `aomi_users.id` mirroring BetterAuth user; EVM identity
  chain-independent for EOAs, chain-scoped for smart accounts; anonymous
  wallet-only users; display name derived from address.
- **Sessions/tokens:** BetterAuth + bearer plugin from day one; 7d rolling-daily;
  portal injects the Rust bearer; Rust mints now / portal at Phase F.
- **Merge model (the investigation result):** one signal-resolution ladder —
  unclaimed auto-links; a signal owned by another account warns (yellow if it
  survives, **red** if it's the last factor → move + absorb data + permanently
  close). Merge only in the red case, survivor always the current account,
  reactive only, email follows the same ladder. "Recovery" falls out of moving
  your wallet; no separate merge engine. Threads follow the wallet (real re-key is
  Phase F; v1 records the policy + an `aomi_account_events` row).
- **Build boundary:** ~85-90% ships on portal + a fresh Supabase project with the
  Rust backend untouched (the account layer is additive); §14 has the Phase F
  handoff contract.
- **Still open (data, not design):** the real `trustedOrigins` list; the Phase F
  id-mapping final pick (leaning DB unification).

Precursor PR (agreed, backend-free): the `walletKey` SVM case-sensitivity fix.

### Widget auth plan review + locked decisions (2026-06-17)

Branch `polish-multi-wallet`. No code — collaborative review of
`specs/WIDGET-AUTH-PLAN.md` (BetterAuth + SIWE + Privy/Para → canonical
`aomi_users` model). Verified the plan against the tree: `walletKey` SVM bug is
real (`wallet-utils.ts:5`), `AccountRuntime` is the thin stub the plan describes
(`account/types.ts`), and `apps/portal` is already a BFF proxy
(`api/[...slug]/route.ts` forwards `authorization` + allowlists
`/api/account/sessions/exchange`). Key find: `AomiAccountCredential`
(`types.ts:260`) already has provider-token + `{ kind: "cookie" }` variants and
`getAccountCredential` is documented to exchange for a short-lived Aomi bearer.

Four decisions locked at the time (now superseded for backend auth by the
2026-07-01 static service-topology AccountBearer path): (1) trust boundary =
thin token at the backend — BetterAuth signs an Aomi backend JWT carrying
`aomi_user_id`, Rust verifies it via JWKS;
(2) session transport pluggable — same-origin cookie now, bearer addable later;
(3) BetterAuth = successor to the System A account-session exchange, MCP approvals
(System B: `packages/auth`) untouched, reuse `makePrivyJwtVerifier`; (4)
the original SIWE-first Phase 1 decision is superseded by the 2026-06-19
policy-free model where any verified wallet or provider can create/sign into an
account. First two PRs are pure: `walletKey` SVM fix +
`AccountRuntime`/`AccountWallet` type widening (§8.3). Delivered four
diagrams (system+trust-boundary, three identity layers, ER data model, System A
vs B). See [[widget-auth-plan-decisions]].

### Account manager slide-in + ungated Account button (2026-06-16)

Branch `polish-multi-wallet`. `wallet-picker.tsx` + `wallet-picker.test.tsx`.
First slice of the locked account-management UI design (see
[[wallet-account-mgmt-ui-design]] / `specs/WALLET-ACCOUNT-MGMT-UI.md`) — the
push-nav shell + an Account panel stub.

- **Account button now shows for any connected wallet.** Was gated on
  `identity.isConnected && openAccountUI && canOpenAccountUI` (Para/Privy only);
  now gated on `hasConnectedWallets`, so wallets-only/external sessions get it too.
- **Clicking "Account" slide-navigates instead of opening the provider modal.**
  The picker body is now a double-width push-nav track (`w-[200%]`, two
  `w-1/2` panels, `-translate-x-1/2` on `view === "account"`, 300ms ease-out).
  Each panel has its own header; the inactive panel is `inert`. New `view`
  state (`"wallets" | "account"`), reset on close and when all wallets drop.
- **`AccountManagerPanel` stub**: back-chevron header, an identity card
  (provider brand mark or `UserRound` + display name + provider/wallet-count
  subtitle), three dashed "Soon" placeholder rows (Profile / Linked wallets /
  Security), and — only when `openAccountUI`+`canOpenAccountUI` exist — an
  "Open provider settings" row that hands off to the native provider modal
  (so Para/Privy lose nothing). The per-row gear "manage" action is unchanged.
- `ManageAccountButton` is now pure navigation (dropped its `canOpen` gate +
  async spinner).
- Tests: retargeted "opens account management from the picker header" →
  "slides to the account manager and can open the provider UI"; added
  "shows the account button for a wallet-only session without a provider UI";
  loosened the duplicate-"Account" text assertion; flipped the Privy-session
  test to expect the button present. New/changed picker tests pass.
- **Pre-existing failures (NOT from this change, confirmed against pristine
  HEAD):** `wallet-picker > uses the Para brand mark for manageable Para
accounts with generic names` (`getWalletIcon("…para…")` → null brand, likely
  fallout from the recent icon-registry refresh) and `network-select >
connects without a family selection`.
- Not yet eyeballed live (the connected state needs a real wallet extension):
  confirm the slide reads cleanly and the stub panel looks right.

### Wallet-kit cleanup sweep execution (2026-06-15)

Implemented a verified cleanup pass against `specs/WALLET-KIT-CLEANUP.md`:

- **C1 account ownership:** `selectAccounts(state, family, now, chain?)` now builds
  one family at a time; EVM/SVM runtimes call it with their own family; the composer
  concatenates disjoint EVM + SVM rows; `dedupeAccounts` was removed.
- **C2 partial:** dropped `ExecutionRuntime.svm`; the composer reads SVM signing/RPC
  methods only from `svm.execution`, removing the six `??` fallbacks.
- **C3 picker rows:** `WalletPicker` now consumes `adapter.walletModalRows` for
  live, stored, option, Solana, generic browser-wallet, and social/auth rows, and maps
  row actions back to the existing adapter handlers.
- **C4 duplication consolidation:** added shared `walletKey`/`toRegistryFamily`
  helpers, folded `composer/build-accounts.ts` into `accounts.ts`, merged provider
  label formatting into `formatWalletProvider`, consolidated AA provider-state
  resolution behind a single owner-strategy resolver, renamed the config-side native
  execution policy resolver, and renamed the wallet-kit address formatter to
  `formatWalletAddress`.
- **C6 Privy symmetry:** split the Privy provider monolith into
  `PrivyPluginProvider.tsx`, `PrivyProvider.tsx`, `privy-auth.ts`, `privy-svm.ts`,
  and `privy-execution.ts`; `privy.tsx` is now a compatibility barrel; Para and
  Privy plugins both expose `isAvailable`.
- **C5 dead code/deps:** removed `useSafeWagmiAccount`,
  `isProviderInternalWalletLabel`, public `EVM_PRESETS`/`SVM_WALLET_PRESETS` barrel
  exports, internal SVM helper exports, the dead Para Solana wrapper/deps, the
  branch-only `AomiBaseAccountProvider` surface/folder, and
  `ParaPluginProvider.solanaConfig`.
- **C7 layering:** moved identity grace into `registry/`, SVM network shaping into
  `catalog/`, AA owner into `execution/`, folded root wallet preferences into
  `network-preferences.tsx`, deleted `wallet-family.ts`, deleted the root
  `wallet-execution.ts` shim, and deleted the unused `internal.ts` barrel/subpath.
- **C8/C9 finish:** extracted adapter actions to
  `composer/build-wallet-kit-actions.ts`, split full-testnet pure config into
  `full-testnet-config.ts`, moved the auth-plugin composer ternary into
  `WalletKitComposerOutlet`, added the shared `WalletRuntime<F>` surface, and moved
  internal SVM identity fields to `svm*` while keeping deprecated `solana*` aliases.
- Rebuilt registry artifacts and synced `apps/registry/dist` to `apps/landing/public/r`.

Verification run:

- `pnpm run typecheck`
- `pnpm typecheck:landing`
- `pnpm --filter @aomi-labs/widget-lib exec vitest run src/lib/wallet-kit src/components/control-bar/wallet-picker.test.tsx`
- `pnpm exec vitest run packages/client/test/registry-chain-artifacts.unit.test.ts`
- `pnpm exec vitest run packages/`
- `pnpm run lint`
- `pnpm run build:lib`
- `pnpm run build:registry` + `rsync -a --delete apps/registry/dist/ apps/landing/public/r/`

Still open in the cleanup doc: the remaining C8 config-ladder collapse item and all
manual wallet-extension checks (E1/E3/E4/E5/E6/S1/S2/S3/S4/D1/P1).

### Wallet-kit cleanup sweep spec (2026-06-15)

Branch `polish-multi-wallet`. No code changes — second deep audit of the wallet-kit
after most of the migration landed, plus a new **`specs/WALLET-KIT-CLEANUP.md`**:
a 10-phase (C1–C10), checkbox-driven, verifiable cleanup backlog with a final gate +
manual landing matrix. Scorecard: registry core / EVM execution factory / pure
registry sources / SVM commands / catalog are clean; the remaining debt is a
consistency finish. Findings:

- **Root coupling (C1):** `registry/selectors.ts` `selectAccounts` is family-agnostic;
  the EVM runtime returns both families unfiltered while SVM filters — so
  `evm.selectAccounts() ⊇ svm.accounts()`, which caused the duplicate-Solana-row bug
  the user's agent band-aided with `dedupeAccounts`. Fix: `selectAccounts(state, family, now)`.
- **Symmetry (C2):** `EvmWalletRuntime`/`SvmWalletRuntime` are still two bespoke types
  (no shared `WalletRuntime<F>`); SVM execution has two sources → 6 `??` in the composer;
  SVM connect/disconnect control-flow still lives in the composer (double-disconnect).
- **Picker (C3, decided=wire it):** `walletModalRows`/`mergeWalletRows` is produced but
  the picker never reads it (builds rows ad hoc). Wire the picker, delete the assembly.
- **Dup (C4):** `walletKey` (×5), `formatProvider`≈`formatWalletProvider`, two ~80%
  AA resolvers, inline `solana→svm` mapping (×3), `formatAddress` ×2, name collisions.
- **Dead code/deps (C5, decided=delete now):** `useSafeWagmiAccount`,
  `isProviderInternalWalletLabel` stub, dead Para Solana wrapper in `para-svm.tsx`
  (drops `@getpara/solana-wallet-connectors` + `@solana-mobile/...`), `AomiBaseAccountProvider`
  - duplicate `base-account` branch + `ParaPluginProvider.solanaConfig`, `wallet-family.ts`
    (`toWireWalletFamily` 0 callers), dead `internal.ts` barrel, zero-consumer presets.
- **Provider symmetry (C6):** Privy is a 658-line monolith; split to mirror Para's
  file layout + align the plugin `isAvailable` field.
- **Layering (C7):** `registry/selectors.ts`→`runtime/evm/identity-grace` (real
  violation; move down); fold `aa/` into `execution/`; collapse root `persistence.ts`
  (dead `selectedFamily`) into `network-preferences`; delete root `wallet-execution.ts`
  shim + move its test.
- **Decomposition (C8):** config provider is STILL an 8-component ladder (the collapse
  never happened); composer `adapter` useMemo ~220 lines → extract `build-wallet-kit-actions`.
- **Naming (C9):** `AomiSessionIdentity` mixes `svm*`/`solana*`; `EvmIdentityTransform`
  via `ReturnType<…>`.

Decisions locked: wire the picker; one combined doc (incl. symmetry finish); delete the
branch-only deprecated surface now. Pending: execute C1–C10.

### Wallet-kit finish-line plan rewrite (2026-06-15)

Branch `polish-multi-wallet`. No code changes — broad architecture review of the
whole wallet-kit (4 parallel deep-dive audits: provider asymmetry, EVM/SVM runtime
symmetry, consumer surface/exports, registry core) and a from-scratch rewrite of
**`specs/WALLET-PROVIDER-PLUGIN-REFACTOR.md`**. Findings re-baselined against the
actual half-migrated tree:

- **The registry core is the good part** (pure reducer + policy + `planCommands` +
  store; active-per-family). Keep it; only consolidate scar tissue (suppression-
  reason list duplicated ×3, double-counted heal budget, extract connection-order).
- **Four seams are the real mess:** (1) two public entry points that disagree
  (`config/AomiWalletKitProvider` capability path vs `providers/index.tsx`
  `AomiWalletProvider` union) + a dead second Para mount path (`para.tsx` +
  `paraPlugin.render`, reachable only from a dev driver); (2) EVM is a real runtime
  but SVM is call-site glue (no `useSvmWalletRuntime`; connect/disconnect/identity
  smeared across the composer; SVM connect bypasses `planCommands`); (3) half-
  finished `svm`/`solana` rename with ~17 `Solana*=Svm*` aliases running through
  file interiors; (4) duplication + leaky surface (`para-aa.ts` ≈95% copy of
  `execution/aa-provider-state.ts` with drifted Alchemy/Pimlico precedence; `index.ts`
  re-exports ~100 internals via 13 `export *`; `registerAomiParaWalletProvider()`
  side-effect foot-gun that silently degrades to wallets-only if forgotten; landing
  imports via `../../../registry/src` + dev drivers reaching into `providers/para`).
- **Plan shape:** P1 vocabulary (svm internal, solana public edge) → P2 symmetric
  `useSvmWalletRuntime` + `svm/connect`·`svm/disconnect` registry commands +
  `selectSvmIdentity` → P3 unify execution behind `runtime.execution.send/sign`
  (move inline `executeWalletKitTransaction` out of composer) → P4 one
  `resolveAAProviderState({ ownerStrategy })` → P5 single entry + self-registering
  plugins that throw on misconfig + delete dead Para path → P6 registry scar
  cleanup → P7 barrel hygiene + consumer DX + dev-driver relocation → P8 whole-
  migration gate (automated + invariant re-check + manual landing matrix E1–E8/S1–S3/D1/P1).
- Decision: **full EVM/SVM symmetry in scope this migration** (not deferred). User
  approved rewriting the spec in place.

Pending: await go/no-go to execute P1–P8. No production code touched yet.

### Wallet-kit P3 cleanup sweep — Tiers 1–3 (2026-06-14)

Branch `polish-multi-wallet`. Three committed, independently-green tiers from the
architecture review. Each verified with `typecheck:landing`, the packages vitest
suite (363) + the apps/registry wallet-kit suite (128, via
`pnpm --filter @aomi-labs/widget-lib exec vitest run`), lint, and the pinned
registry-artifact test; artifacts rebuilt + synced to `apps/landing/public/r`.

- **Tier 1 (`62cfff62`):** new `execution/execution-runtime.ts`
  (`buildEvmExecutionRuntime`) routes the Para/Privy/wallets-only EVM execution
  lanes through one factory (removed ~15 duplicated lines each); deduped
  `detectSvmTransport`/`getSvmCapabilitySnapshot` (composer imports them from
  `runtime/svm`); widened provider-id + `linkedVia` unions to branded open
  strings (`(string & {})`) so adding a provider is no longer a type edit.
- **Tier 2 (`c6d82b15`):** `runtime/evm/brands.ts` gains a `registerWalletBrand`
  registry and drops the hardcoded `"para"` branch — Para registers its brand
  from `providers/para/para-brand.ts` (`PARA_BRAND_KEY`); `wallet-picker`
  `linkedVia` switch generalized off `para`/`privy`. Legacy `detached-para`
  persistence key + `paraDetached` field documented as frozen core migration
  identifiers (moving them into providers/para would regress a wallets-only build
  opened after a Para session).
- **Tier 3 (`08d7d0db`):** `providers/plugin-registry.ts` +
  `para-plugin.tsx`/`privy-plugin.tsx` descriptors replace the
  `if (provider === "para"/"privy")` branches in
  `config/AomiWalletKitProvider.tsx`, which also drops its direct
  `@getpara/react-sdk` import. Eager registration only.

Deferred (flagged to the user): lazy bundle-split of provider registration;
hoisting `WalletRegistryStore` out of the EVM runtime (its executors are
wagmi-specific, so the hoist only pays off for a Solana-only-without-EVM target,
which does not exist today).

### Wallet provider plugin refactor — grand plan rewrite (2026-06-13)

Branch `polish-multi-wallet`. No code changes — full rewrite of
**`specs/WALLET-PROVIDER-PLUGIN-REFACTOR.md`** into a single-PR "finalize
everything" plan with exact structs, the `AomiWalletKit*` naming, target folder
tree, and per-phase (P0–P8) execution detail. Decisions locked this session
(13 total) after a deep read of the actual built code (composer, Para/Privy/Base
plugins, EVM/SVM runtimes, registry core, account stub, `para-aa.ts`,
`wallet-execution.ts`, `aa/owner.ts`):

- **Naming:** wallet/account layer is `AomiWalletKit*` (NOT `AomiRuntime*` —
  that collides with `@aomi-labs/react`'s chat widget `AomiRuntimeProvider`/
  `useAomiRuntime`). `AomiWalletKit→AomiWalletKit`, `AomiSessionIdentity→
AomiSessionIdentity`, `socialLoginOptions/connectSocial→authMethods/
authenticate`, `evmWallets/solanaWallets→walletOptions`. All old names kept as
  `@deprecated` aliases for 1–2 releases.
- **Lost-wallets fix (P1):** Aomi-owned connector catalog (`catalog/`) supplying
  injected EIP-6963 + WalletConnect + Coinbase + Base Account in ONE isolated
  wagmi config, replacing the 3 duplicated per-provider configs. WC ships an
  Aomi default projectId (host override). Installed wallets already arrive via
  EIP-6963; the real gap was only WC + Coinbase. Para's modal becomes auth-only.
- **One composer path (P2/P5):** Privy and Base stop hand-building adapters; Base
  is fully replumbed to a `baseAccount()` catalog connector + execution policy
  (no longer a provider mode).
- **AA fix (P4):** additive `external-wallet` `AAOwner` variant in
  `@aomi-labs/client` (CLI `direct` + Para `session` branches untouched);
  wallets-only/Privy get real AA; the `if (!paraSession)` gate that starved
  external-wallet 4337 is dropped from the generic path. 7702→4337 fallback for
  external signers stays. Key finding: AA engine is Aomi's (Alchemy/Pimlico via
  env); Para's only role is the embedded owner/signer (the "session" = signing
  authority).
- **Public API (P6):** capability-shaped `AomiWalletKitProvider` with
  `auth`/`wallets:{evm,solana,embedded}`/`execution`/`account` + presets
  (`para`/`privy`/`wallets-only`). Embedded nested under `wallets`, usually
  implicit from the auth provider. Config = presets + override + BYO connectors.
  **wallets-only is first-class.**
- **Identity split (P0):** `walletProvider → authProvider/embeddedProvider/
walletSource`; types now, `/api/state` payload migration deferred with backend.
- **Multi-provider future:** decision #1 revised — one canonical auth (Better
  Auth), many linked providers/embedded wallets switchable, hosted SDKs
  lazy-mounted one at a time. The `mergeWalletRows` stored→`authenticate` path
  (currently computed-and-discarded) gets wired (P7) as the seam; stored wallet =
  read-visible only, write approval separate/deferred.
- **"Preview" dropped** — confirmed no such concept in code; it was "Privy."

Pending: await go/no-go to execute P0–P8. No production code touched yet.

### Wallet provider plugin refactor plan rewrite (2026-06-12)

Branch `polish-multi-wallet`. No code changes — rewrote
**`specs/WALLET-PROVIDER-PLUGIN-REFACTOR.md`** after a planning discussion grounded in
`meeting-2026-06-10-wallet-auth-backend-frontend.md`. The plan is now the successor to
WALLET-ARCHITECTURE.md §12–13 / WALLET-REFACTOR-PLAN.md. Headline changes:

- **"Wallet Links Runtime" renamed to Account Runtime** and re-shaped around a canonical
  Aomi user (`{ user, linkedAccounts, wallets }`): provider subjects (Para/Privy/Google)
  are linked accounts _under_ the user, not the root identity. `capability: "read"|"write"`
  reserved on stored wallets (linking ≠ authorization, per the meeting's impersonation
  discussion); `verifiedAt` optional; `linkedVia` gains `"observed"`.
- **Session model written in**: provider session (browser credential source) vs Aomi
  session (canonical; today `POST /api/account/sessions/exchange`, later same-origin
  cookie via Next.js server functions + Better Auth). `AomiAccountCredential` gains a
  `{ kind: "cookie" }` variant; no bearer-token assumption in the widget.
- **11 locked decisions** recorded (auth singular per deployment with `methods[]`
  multiplicity; `kind: "wallet"` method reserved for future SIWE, not built; approval
  granularity deferred; stored external row → connect, stored embedded row →
  `authenticate` action routing to `auth.login`; Para-branded connector supply kept this
  PR; RainbowKit-style BYO connect UI compatible by construction, deferred; etc.).
- **PR boundary**: this PR = Phases 1 (done) – 6: composer extraction, complete SVM
  runtime extraction out of para-sol.tsx, Para plugin split, Account Runtime
  **types + disabled stub only** (merge path tested with a mocked ready runtime, zero
  network calls), naming sweep last + cuttable. Deferred list is explicit (real Account
  Runtime, approvals, SIWE, Base Account replumb, 6963 migration, identity
  `walletProvider` split).
- Baseline verified at planning time: 110 registry tests green (18 files), F1 fix
  (`?? []` at `context.tsx:61`) confirmed in code, `runtime/solana/` already holds
  networks + registry-source.

Pending: execute Phases 2–6 of the plan; manual browser matrix at the end (extensions).

### Wallet refactor review → WALLET-FOLLOWUP-FIXES.md (2026-06-12)

Full review of the executed `WALLET-REFACTOR-PLAN.md` work plus the manual results in
`docs/wallet-manual-test-results-2026-06-12.md`. No production code changed; all
findings + executor instructions live in **`WALLET-FOLLOWUP-FIXES.md`** (repo root).
Automated baseline green at review time (107 registry tests, 360 root, lint, both
typechecks). Headline root causes, all code-verified:

- **`/api/state` 400 (rows 19–22) = `svm.capabilities: null`** at `context.tsx:61`;
  backend `Vec` + `#[serde(default)]` rejects explicit null (proven against the real
  product-mono deserializer). `auth_method: "wagmi"` is innocent. Fix: `?? []` (F1).
- **Para-auth wallet wipe with no recovery (rows 7–8) = settle timer killed** in
  `sources/wagmi-source.ts` — connections-effect cleanup clears the shared timer, the
  early-return never re-arms it → `wagmi/settled` never fires → `planHeal` never runs.
  The two earlier "heal timing" hotfixes patched symptoms of this (F2, then F3/F12).
- **Rabby → add MetaMask no-op (row 12)**: Para's branded MetaMask connector binds
  Rabby's provider (default-wallet takeover); dedupe discards the real `io.metamask`
  6963 connector; same-address connect collapses into the Rabby row (F5).
- **Phantom EVM auto-connect (rows 2/5)**: no-arg wagmi `reconnect()` tries ALL
  connectors (storage only sorts); heal executor + reconnectOnMount both trigger (F4).
- **Review defects**: 5792 `connector` silently dropped by `useSafeSendCallsSync`
  (CRITICAL, F6); capabilities not active-keyed (F7); `selectAccount` dispatch-last +
  synthetic Para row unselectable (F8); align-to-preference effect deleted undocumented
  (F9, needs decision); `resolveActive` ignores droppedAddresses (F10); family
  disconnect grace zombie (F11); picker DO-NOT-TOUCH edit removed per-row Para sign-out
  (F13, needs decision); + P3 cleanups.
- **Process**: phases 0–9 were left entirely uncommitted (plan required per-phase
  commits) — executor must commit the current tree first (fix doc §0).

### Wallet registry refactor: phases 5, 6, 8, 9 + artifacts (2026-06-11)

Branch `polish-multi-wallet`. Continued `WALLET-REFACTOR-PLAN.md` from Phase 5.

- **Phase 5 heal/disconnect is reducer-driven now.** `useWalletRegistry` uses real
  command executors instead of shadow logging: `wagmi/reconnect`, budgeted
  `wagmi/connect` by stable connector id, surgical `wagmi/disconnect` by uid, and
  Para logout via the existing hook/client fallback. The old Para-local heal ladder
  (`evmReconnect*`, `evmReattach*`, suppression refs, explicit dropped-address refs,
  active-evm legacy persistence writes) was removed from `para.tsx`. The store
  destructively migrates the old active/detached localStorage keys into
  `aomi.wallet.registry.v1`.
- **Two-pass heal is pinned.** After a config rebuild settles, the first pass runs
  silent reconnect; if nothing returns, the store schedules a second settled pass so
  policy can spend the popup reattach budget. Tests cover reconnect -> connect, budget
  decrement, suppression boundary (`now === suppressedUntil`), dropped-address heal
  exclusion, and same-address Para sign-out preserving the surviving external wallet.
- **Disconnect intent is centralized.** Per-row disconnect dispatches
  `user/disconnect-account` with the existing `evm-disconnect-plan.ts` result; the
  reducer now has an optional `markDroppedAddress` so signing out Para while a
  same-address MetaMask/Rabby remains does not suppress the surviving account.
  Family/all disconnect dispatches `user/disconnect-family`; Solana direct disconnect
  remains in the adapter for Phase 6 compatibility.
- **Phase 6 Solana connect machine moved to `sources/solana-source.ts`.** The transient
  `pendingSolanaWallet` intent lives in the registry, with
  `solana/connect-requested` and `solana/connect-settled` events. The source owns the
  400 ms autoConnect grace, observes wallet-adapter `connecting`, calls manual
  `connect()` once if needed, and avoids re-popping after an observed dismissed attempt.
  `para.tsx` now only validates/selects a wallet and dispatches the request.
- **Phase 8 stretch:** added `/privy` in the landing app, rendering the real widget
  inside `LandingPrivyProvider` for manual Privy matrix runs.
- **Phase 9 groundwork:** `AomiAccount` gained optional `linked`/`linkedVia` fields, and
  `registry/types.ts` gained future `WalletLink`. `specs/DOMAIN.md` now records the
  invariant that active wallet per family is owned by `WalletRegistry` and wallet
  recovery decisions are reducer transitions. Mechanical grep confirms
  `useSafeWagmiAccount` is no longer used inside `providers/para/`.
- **Registry artifacts refreshed.** `apps/registry/src/registry.ts` now includes the
  registry core/source files and wallet picker stack that were previously stale.
  Ran `pnpm run build:registry`, synced `apps/registry/dist` into
  `apps/landing/public/r`, and the pinned registry artifact test is green.
- **Phase 7 caveat:** the registry file lists/artifacts were refreshed, but the large
  `para.tsx` decomposition into <400-line modules was not performed in this pass to
  avoid a high-risk mechanical move on top of behavior changes. This remains the main
  incomplete item from the written execution plan.
- **Automated verification run:** registry focused tests (27 registry tests), picker
  tests, `pnpm --dir apps/registry exec tsc --noEmit`, `pnpm run build:registry`, and
  `pnpm exec vitest run packages/client/test/registry-chain-artifacts.unit.test.ts`.
  Manual matrix rows still require browser wallet extensions and are not claimed here.

Follow-up from manual browser testing: opening the Para login modal with external wallets
connected, then cancelling before login, could wipe all EVM connections because
`para/auth-flow-started` suppressed popup reattach and the Phase 5 policy did not attempt
silent recovery during ordinary `settling` transitions. Fixed `planHeal` so non-stable
missing external wallets run silent `wagmi/reconnect` even while popup reattach is
suppressed, while still refusing to heal deliberate family disconnects or dropped
addresses. Debug `evm:heal` now reports `phase` and `suppressed` for this path.
Second follow-up: allowing popup reattach during Para auth fixed the cancelled-login wipe,
but it could reopen MetaMask/Rabby while a Google login was still in progress. The store
now delays the post-`wagmi/reconnect` settled pass from `SETTLE_QUIET_MS` to
`AUTH_FLOW_RECONNECT_SETTLE_MS` while Para auth suppression is active, so silent reconnect
gets a chance to restore authorized wallets before the budgeted popup fallback is planned.

### Wallet registry refactor: executable plan (2026-06-11)

Branch `polish-multi-wallet`. New **`WALLET-REFACTOR-PLAN.md` at repo root** — the
phase-by-phase execution plan implementing WALLET-ARCHITECTURE.md §12, written for an
executor agent. No code changes. Structure:

- **10 phases (0–9), each independently green + committable**: 0 manual test matrix
  (16 rows, M1–M16) → 1 WalletRegistry pure core (types/reducer/policy/commands/
  persistence/store + unit tests, unwired) → 2 sources mounted in **shadow mode**
  (wagmi/para-session/solana sources dispatch real events, no-op executors,
  `registry:shadow-diff` comparison logging) → 3 flip identity+accounts to registry
  selectors (grace preserved as state+selector) → 4 **the behavior flip**: registry-owned
  active per family + explicit `connector:` threading through every wagmi action
  (sendTransaction/sendCalls/signTypedData/switchChain/getWalletClient for AA signer),
  delete the enforcement war + legacy localStorage keys (destructive migration) →
  5 heal ladder + disconnect intents as reducer policy (two-pass reconnect→connect,
  budget 2, 5-min suppression; reuses evm-disconnect-plan verbatim) → 6 Solana connect
  state machine into solana-source → 7 decompose para.tsx (<400-line modules, re-exports
  keep import sites; fix stale registry.ts file lists; rebuild dist + sync
  apps/landing/public/r + pinned-artifact test) → 8 optional Privy demo route →
  9 linking groundwork types (`linked`/`linkedVia` on AomiAccount, `WalletLink`),
  DOMAIN.md invariants ("never read wagmi current"), cleanup.
- **Hard guardrails**: DO-NOT-TOUCH list (types.ts additive-only, runtime-tx-handler,
  picker UI, packages/client, packages/react, context.tsx, backend payloads, privy/
  base-account until Phase 8); 9-item functional-invariants checklist; 14 documented
  gotchas (adapter must never unmount, ParaProvider prop stability, wagmi uid regenerates
  per load → persist address+connector.id, grace stays expired, canConnect ungated,
  manageable gating, Phantom-EVM 6963 fuzzy match, Rabby brand sniffing, double-path Para
  logout, switch-in-flight guard, AA both owner shapes/4337-only external, jsdom stubs,
  pure-reducer Date.now() discipline).
- **Verified baselines recorded in the plan**: registry suite 67 tests green
  (`cd apps/registry && pnpm exec vitest run`), registry tsc clean (the previously
  flagged GITHUB error at para.tsx:231 no longer reproduces), exact build/artifact
  commands (`pnpm run build:registry` + cp to `apps/landing/public/r/`).
- Effort map: ~7–10 days core path; Phases 0–4 alone are a coherent smaller PR
  (headline fixes: stable active wallet, enforcement deleted).

### Wallet architecture document + replan (2026-06-11)

Branch `polish-multi-wallet`. New **`WALLET-ARCHITECTURE.md` at repo root** — no code changes.
Full-stack explainer + diagnosis + refactor plan for the wallet/auth mess, written after a
deep sweep of the adapter lib, UI surfaces, AA/CLI flow, host wiring, and the Para/Privy
official docs + shipped SDK source. Key findings recorded there:

- **Root diagnosis**: Para is both identity provider AND wallet plumbing while we bypass its
  account model (Para's own "NONE connection mode" — external wallets via
  `externalWalletConfig` are local wagmi connections, NOT account-associated). Active wallet
  = wagmi's mutable `current` pointer, which Para's SDK re-asserts via a shipped
  `connecting_para_connectors` state machine (source-verified) — all rounds 1–5 machinery
  (enforcement budgets, heal ladder, grace windows) fights that.
- **Phantom-EVM stability explained**: it connects via wagmi's EIP-6963 injected connector
  (PHANTOM isn't in our Para external list), bypassing Para's branded-connector lifecycle.
- **Para AA constraint confirmed**: 7702 = embedded wallets only (EIP-191 prefix vs raw
  ecrecover); external wallets = 4337 only.
- **Para Account Linking** exists (getLinkedAccounts/linkAccount/verifyExternalWalletLink,
  June 2025) but is thinly documented; Para JWT carries `wallets[]` + `connectedWallets[]`.
  Privy's linked-accounts natively models the end-state (unlimited linked wallets,
  identity tokens). `/api/account/sessions/exchange` already accepts both providers.
- **Proposed target architecture** (doc §12): single owned WalletRegistry store (pure
  reducer), wagmi/Para/wallet-adapter demoted to event sources, active-per-family declared
  not derived, signing routed via wagmi's explicit `connector` param (verified in
  @wagmi/core types) so the `current` pointer is never read → enforcement deleted.
  One versioned localStorage key replaces active-evm-address + detached-para keys.
- **8-step plan for next PR** (doc §13): test matrix → registry in shadow mode → flip
  identity/accounts → flip signing + delete enforcement → reducerize heal/intent →
  decompose para.tsx (<400-line modules) → Privy demo route → linking type groundwork.
- **Open product decisions** (doc §14): linking strategy (Para linking vs Privy vs own
  signature-challenge), offer-linking UX, possibly migrating MM/Rabby to plain 6963
  connectors, SVM cluster-switch remount UX.

### Wallet round 5: adapter must never unmount + re-attach popup cap (2026-06-10)

Branch `polish-multi-wallet`. Round-4 fixed refresh-active (user confirmed). Two remaining reports, one structural root cause found:

- **"A while after Para sign-out, all wallets disconnect (and the Para quick-sign-in row looks disabled for a bit)"** — root cause: `ParaSolanaWrapper` rendered `children(false)` (raw children, NO `AomiParaPluginProvider`) whenever `useParaClient()` returned null. Para nulls its client transiently during logout/re-init → the **entire adapter subtree unmounted** → all connection state + heal refs destroyed, no recovery possible. Fix (`para-sol.tsx` + `para.tsx` Inner): the wrapper now caches the last non-null client (`lastParaRef`) so the branch never flips back to providerless mid-session, takes plain `ReactNode` children, and the Inner renders `FullTestnetWalletRouter`+`AomiParaPluginProvider` in BOTH wrapper states — only the Solana context comes and goes; the safe Solana hooks already degrade without it. Logs `para:solana-wrapper {ready}` on flips. (The "disabled for a bit" part is cosmetic: while the sign-out runAction awaits the Para server logout, the picker's global `pending` disables all rows.)
- **"Connecting Para also pops the MetaMask/Rabby extension"** — the re-attach heal re-arms on every connector-set rebuild (the Para login modal rebuilds the config) and `connectAsync` on a locked/de-authorized wallet pops the extension UI. Fix: lifetime budget of 2 re-attach runs per page load (`evmReattachBudgetRef`; logs `re-attach-budget-exhausted`). Storage-based `reconnect()` stays unlimited — it's always silent.
- **Verify next**: Para sign-out with MetaMask+Phantom connected → survivors should stay connected (heal now survives because the adapter doesn't unmount; look for `para:solana-wrapper` + `evm:heal` lines); opening Para login with wallets connected → no MM/Rabby popups (at most 2 lifetime, only after a real wipe).

### Wallet round 4: enforce-budget refund + Para logout fallback (2026-06-10)

Branch `polish-multi-wallet`. The round-3 trace nailed the remaining refresh bug: Para doesn't steal once — wagmi flips `current` to the just-(re)connected connector as each connection completes during boot (connections grew 1→2→3→4; Para re-asserted 4+ times in one load). The enforcement's "satisfied → reset budget" never fired because each satisfaction landed while the previous switch was still in flight (`skip: switch-in-flight` in the trace), so attempts accumulated ACROSS won fights and the 4th theft hit `budget-exhausted` → Para wins. **Fix**: refund the budget when a `switchAccountAsync` _succeeds_ (in `.then`), so the 3-attempt cap only bounds _consecutive failed_ switches — the boot-time war is now won regardless of rounds. Known tradeoff: switching to the Para account from inside Para's own modal would be fought back (the picker is the canonical switch surface; picking Para there updates the persisted choice so no fight).

Second report from the trace session: **per-row Para sign-out doesn't stick across refresh** (post-disconnect trace showed `init {persisted: null}` then Para reconnects as the sole connection). Instrumented + hardened: `evm:account-sign-out` log (wallet/address/isParaAccount/connectors-being-disconnected), `para:logout` logs (via useLogout / via client / ok / failed / no-path), and a duck-typed fallback to `paraSession.logout()` when the `useLogout` hook is missing or rejects — a sign-out can no longer silently no-op. **Awaiting next trace run** to see which logout path fires and whether it errors; if `para:logout` says ok and Para still re-attaches, the session revival is server/cookie-side and needs Para SDK escalation.

Also noted from the trace, unrelated: `wallet_getCapabilities` via Para's EIP-1193 provider hits `https://mainnet.base.org` and gets 403 (public RPC rejects it) — noisy but harmless; consider a capabilities transport override later.

### Wallet round 3: active-wallet debug tracing (2026-06-10)

Branch `polish-multi-wallet`. Para STILL wins active after refresh despite the round-2 enforcement — cause unknown without a timeline, so this round instruments instead of guessing. New `lib/wallet-kit/wallet-debug.ts` (`walletDebug()`, console.info under `[aomi-wallet]`; ON by default in dev, toggle via `localStorage["aomi.wallet.debug"] = "1" | "0"`). Traced: `active-evm:init` (persisted target at mount), `evm:current-changed` (current address/connector timeline — shows exactly when Para steals), `evm:connections-changed` (whether/when the wanted connection restores after refresh), `active-evm:enforce` (every decision: switch-in-flight / satisfied / wanted-connection-absent / current-not-para / budget-exhausted / target-connector-missing / switching / failed), `active-evm:user-select` + `persisted` + `persist-cleared`, `evm:heal` (reconnect / re-attach steps). Hardening: the enforce budget re-arms when the wanted connection (re)appears or its connector uid changes (early "connector not ready" failures must not consume the budget for the real fight). Exported from the lib index; added to the `aomi-wallet-kit` registry item; dist rebuilt + landing `public/r` artifacts synced. **Next step**: user reproduces the refresh-theft with the console filtered to `[aomi-wallet]` and reports the timeline — the suspect branches are wanted-connection-absent (wagmi never restores the external connection), budget-exhausted, current-not-para (Para connector named something unexpected), or no `switching` line at all (persisted target missing).

### Wallet round 2: Para re-assertion enforcement + Phantom autoConnect race + provider subfolders (2026-06-10)

Branch `polish-multi-wallet`. Follow-up to the round-1 fixes after live testing: three bugs remained + a structure ask. 64 registry + 360 root tests green, lint clean, registry+landing typecheck clean.

- **Active EVM wallet enforcement** (`providers/para/para.tsx`): replaced the attempt-once persisted-active-address restore with a watching _enforcement_ effect. Para's connector re-asserts itself as wagmi's current connection on reconnect/session syncs — stomping the chosen wallet after a refresh (the one-shot restore lost the race) and right after the first switch away from Para (the "flips back, second click sticks" bug). The effect re-switches to the persisted choice whenever its connection is live and the current connection is Para _or vacant_ (never fights a different external connector — that's a deliberate wallet-side switch), bounded at 3 attempts per theft (counter re-arms when satisfied). Covers both reported bugs via one mechanism since `selectAccount` updates the persisted address.
- **Phantom SVM connect race — root cause found in wallet-adapter + Para provider source**: Para's `ParaSolanaProvider` mounts `WalletProvider` with `autoConnect: true` (hard-coded), and wallet-adapter marks `select()` as user-initiated → the provider fires `adapter.connect()` ITSELF when the adapter lands. Our manual `connect()` raced it, and the losing attempt's error path (`onConnectError` → `changeWallet(null)`) **unselects + disconnects the wallet** — click silently dies; localStorage often kept the wallet name so a refresh re-ran a clean auto-connect → "works after refresh". Fix: the pending effect now defers to the provider's auto-connect (watches `connecting`), and only calls `connect()` after a 400 ms grace if _no_ attempt was observed (covers providers without autoConnect). A per-target `solanaConnectAttemptObservedRef` prevents re-popping the wallet after a failed/dismissed attempt and settles the pending state if wallet-adapter unselected the wallet.
- **Provider subfolders**: `providers/para/` (para.tsx, para-sol.tsx, para-aa.ts, evm-identity-grace.ts + test, index.ts), `providers/privy/` (privy.tsx, index.ts), `providers/base-account/` (base-account.tsx, index.ts). Folder names match the old module names, so every existing import path (`providers/para`, `providers/privy`, `providers/base-account`) resolves to the new folder indexes — zero changes at import sites (`providers/index.tsx`, `src/index.ts`). registry.ts file lists updated to the new paths (+ index files, + para-sol.tsx which was previously missing); dist rebuilt; the affected artifacts copied to `apps/landing/public/r/` (committed snapshot read by `packages/client/test/registry-chain-artifacts.unit.test.ts`, whose pinned path was updated to `providers/para/para.tsx`).
- **Still needs live verification**: (1) Para + MetaMask → set MetaMask active → refresh → stays MetaMask; (2) first switch away from Para sticks without a second click; (3) Phantom connects on first click (and doesn't re-pop after a dismissed popup). Watch for: enforcement tug-of-war if Para re-asserts repeatedly (bounded per theft, but verify no visible flapping).

### Wallet stack debloat + six reliability fixes (2026-06-10)

Branch `polish-multi-wallet`. Big pass over the branch's wallet/auth code: extract shared modules, then fix the six user-reported bugs on the cleaner base. 64 registry tests green (5 new), lint clean, registry+landing typecheck clean — including the previously "pre-existing" `GITHUB` OAuth-label error, which is gone (the labels map moved to `Record<string, string>`).

**Refactor / debloat**

- **New `lib/wallet-kit/wallet-brands.ts`** — single home for brand canonicalization + detection: `canonicalWalletKey`, `normalizeWalletOptionId`, installed-extension probes (`useInstalledWalletFlags` + EIP-6963 listener), connector→option mapping (`toEvmWalletOption`, `dedupeWalletOptions`, `walletOptionIsDetected`), social-login option labels (now keyed by `string`, not `TOAuthMethod` — provider-agnostic, kills the GITHUB tsc error), `solanaWalletAllowlist`, and the new provider-brand sniffing (below). Exported via the lib index; added to the `aomi-wallet-kit` registry item file list.
- **New `providers/para-aa.ts`** — `resolveParaSponsorship` + `resolveParaAAProviderState` + the AA env consts moved out of para.tsx verbatim. Added to the `aomi-para-provider` registry item file list.
- **para.tsx 1869 → ~1500 lines.** Also dropped a dead `http` import and the `|| false` tail in `hasAnyDisconnectablePath`.
- **Dedup**: `wallet-picker.tsx`'s `walletAliasKey` and `icons/wallet-map.tsx`'s `getWalletIcon` now delegate to `canonicalWalletKey` instead of re-implementing the brand `includes()` chains (wallet-map keeps a flat map keyed by canonical keys; alias fallback for unknown brands still keys on label only so connector uids don't fragment dedupe).
- **Dead code removed**: `FamilyStatusRow`'s no-`account` branch ("Not connected" fallback + `familyShortLabel`) — the picker always passes an account.
- **`useSafeConnections` memoized** on the wagmi store snapshot — it built a fresh array per render, which sat in the adapter `useMemo` deps and rebuilt the whole adapter every render.
- **Privy readiness (assessed, not wired)**: `providers/privy.tsx` already implements the same `AomiWalletKit` contract incl. `buildAccounts`/`selectAccount`; picker degrades gracefully where it lacks optional fields (`evmWallets` → falls back to `connect({family})`). Architecture is ready; actual Privy wiring deferred per user ("don't break too much before this PR").

**Bug fixes (all need live verification with real extensions — user testing manually)**

1. **Connect-button parity** (`dual-wallet-bar.tsx`): disconnected "Connect wallet" label now sits in an `h-7` row matching `AVATAR_SIZE`, so both states render the same button height/colour.
2. **Rabby shows as MetaMask until refresh** + 3. **adding MetaMask swallowed the Rabby row**: root cause — we displayed `connection.connector.name`, but with Rabby set as default wallet the "MetaMask" connector binds Rabby's provider (`isMetaMask` compat flag). New `detectEvmProviderBrand(provider)` (checks `isRabby`/`isPhantom`/`isBraveWallet`/`isRainbow`/`isCoinbaseWallet` before `isMetaMask`) + `useEvmProviderBrands(connections, connectors)` hook sniffs `connector.getProvider()` per live connection (re-sniffs on membership change, so flipping Rabby's default-wallet setting updates without refresh). Applied to `evmConnectionInputs.walletName` and the grace identity's `walletName`. The merged same-address row now truthfully reads "Rabby".
3. **Phantom click sometimes no-op until refresh** (`para.tsx` + `para-sol.tsx`): `pendingSolanaConnect: boolean` → `pendingSolanaWallet: string | null` (target wallet name). The connect effect now only completes when the _target_ wallet reports connected and waits for the `select()` adapter swap to land — a stale `publicKey` from a previous wallet no longer cancels the pending connect. `connectPreferredSolanaWallet` returns `{status, walletName?}` so callers know what was selected.
4. **EVM wallet vanishes during Para OAuth popup** (`para.tsx`): the one-shot reconnect guard is re-armed whenever Para rebuilds its connector set, and a second heal step re-attaches remembered connectors via `connectAsync` (silent for already-authorized injected wallets; skips para/walletconnect + explicitly dropped addresses) 1.5s after a wipe if storage-level `reconnect()` restored nothing.
5. **Para sign-out killed all wallets** (`para.tsx` disconnect): the per-account sign-out no longer sets the _global_ `explicitEvmDisconnectRef` when other connections remain — it records the address in a new `explicitlyDroppedEvmAddressesRef` set (grace won't resurrect it, re-attach skips it) and re-arms the heal so the Para-logout-induced wagmi wipe restores the surviving external wallets. Family/all disconnects keep the global flag. Deliberate connects clear the dropped set.

**Registry**: dist rebuilt (34 files). NOTE — the registry item file lists are stale for most of the new wallet UI (`dual-wallet-bar.tsx`, `wallet-picker.tsx`, `wallet-icon-slot.tsx`, `wallet-map.tsx`, `icons/wallets/`, `accounts.ts`, `network-preferences.tsx`, `solana-networks.ts`, `para-sol.tsx`, …) — pre-existing gap on this branch, flagged as follow-up.

### Wallet picker: Para brand logo + provider-branded social row (2026-06-10)

Branch `polish-multi-wallet`. `icons/wallets/index.tsx` + `icons/wallet-map.tsx` + `wallet-picker.tsx` + `wallet-picker.test.tsx`. GUI only; backend contract unchanged. Two product asks.

- **Para brand mark wired into the wallet icon map** (`wallet-map.tsx`): reused the existing `ParaIcon` from `icons/apps` (the apps-list Para logo) rather than a duplicate — added `para: ParaIcon` + a `key.includes("para")` branch in `getWalletIcon`. This alone fixes the **connected Para row** — it was falling back to the generic `WalletIcon`; now `WalletIconSlot` resolves "Para" → the real Para logo. Label was already "Para". (Side effect: the connect-bar trigger avatar for Para also shows the logo now — consistent.) `WalletIconSlot` renders the Para mark at `PARA_RATIO` (15% smaller than `BRAND_RATIO`) since it reads heavier than the others at the shared size — same per-brand tuning Phantom already uses.
- **Social-login row rebranded** to the account provider (`wallet-picker.tsx`, `SocialLoginRow`): title = provider brand from `formatWalletProvider(identity.walletProvider)` ("Para"), subtitle = the method label ("Email or Google"), icon = the Para brand mark (`WalletIconSlot`) instead of the mail icon. Was: title "Email or Google" / subtitle "Add an Aomi account" (linked) or "Fast account sign-in" (disconnected) / mail icon. Falls back to the old method-label + mail icon when no provider brand exists (`brandLabel` undefined) — so non-Para adapters degrade cleanly. `aria-label` stays the method label, so existing button-name queries are unaffected. Dropped the now-unused `linkedMode` prop from `SocialLoginRow`.
- Tests: harness identity gained `walletProvider: "para"` (mirrors the real adapter). 2 new cases — social row shows "Para" title + "Email or Google" subtitle + Para brand mark; falls back (no "Para" mark) when `walletProvider` is undefined. 57 registry tests green, lint clean, typecheck clean except the pre-existing `GITHUB` error (`para.tsx:231`).
- **Not yet eyeballed live**: confirm the Para "P" mark reads well at slot size on the connected row + the social row.

### Wallet picker: per-row "manage" action for manageable wallets (2026-06-10)

### Wallet picker: per-row "manage" action for manageable wallets (2026-06-10)

Branch `polish-multi-wallet`. `types.ts` + `para.tsx` + `wallet-picker.tsx` + `wallet-picker.test.tsx`. Backend contract unchanged. Driven by "wallets with a management menu should have a manage option, not just sign out — e.g. Para".

- **New optional `manageable?: boolean` on `AomiAccount`** (`types.ts`). Set when an account has an in-app management surface (the handler is the adapter's existing `openAccountUI({ family })`). External wallets managed only in their own extension (MetaMask, Phantom) leave it unset.
- **Para adapter marks its own account manageable** (`para.tsx`): after `buildAccounts`, accounts whose `walletName` canonicalizes to `"para"` get `manageable: true`, gated on `Boolean(paraModal) && isConnected`. External wallets connected _through_ Para keep their brand name → stay unmanaged. Renamed the `buildAccounts` result to `builtAccounts` and map over it.
- **Picker renders a per-row gear button** (`Settings2Icon`) **before the logout icon** in `FamilyStatusRow`, shown only when `account.manageable && adapter.openAccountUI && adapter.canOpenAccountUI`. Click → `openAccountUI({ family })` then `closePicker()` (the Para modal takes over). New `onManage` prop + `manage:${id}` pending key. The header "Account" button stays (account-level entry); the per-row button is the wallet-level manage. Order in the right cluster: Active pill → manage → logout.
- **Add-list separators tidied** (`wallet-picker.tsx`): a hairline now divides the Connected section from the link/add area (rendered after `connectedSection` when anything follows). The full-list row was renamed `"More wallet options"`/`"Connect or link additional wallets"` → **"Other wallets"** (subtitle still "Open the full wallet list", both modes). The brand connect options render as one **flat list** — EVM, then Solana, then "Other wallets" — with **no separators between families** (the earlier EVM↔Solana hairline was removed per the user, connected and disconnected alike); dropped the now-unused `Fragment` import. Test updated (`"Other wallets"`).
- **Provider sign-in row visibility = gated on Para, not on any connection**: the "Para / Email or Google" row (under a "Quick sign-in" label) shows whenever **Para itself is not connected** — including alongside connected external wallets, so Para stays reachable to (re)connect — and hides once Para is connected (`socialOptionsToShow = paraAccountConnected ? [] : socialLoginOptions`, where `paraAccountConnected = connectedAccounts.some(a => a.manageable)`). The section label is always "Quick sign-in" (dropped the "Link additional accounts" wording the user disliked). (This is the final rule after a back-and-forth: brief "hide whenever connected" pass was reverted per user — they want it shown whenever Para isn't connected.)
- **Active EVM account now persists across refresh** (`para.tsx`). Selecting a non-Para wallet (e.g. MetaMask) as active didn't survive reload — wagmi/Para's connector re-asserts Para as current. Fix: persist the chosen address to localStorage (`aomi.wallet.active-evm-address`) in `selectAccount`, and a once-per-load restore effect re-applies it via `switchAccount` once the matching connection reconnects (guarded by `accountSwitchInFlightRef` so it doesn't fight the reconnect effect). Cleared when that account / the EVM family is disconnected. **Not verified live** — needs two extensions; watch for Para re-asserting active _after_ the one-shot restore (would need a repeating enforce instead of attempt-once).
- **Fixed: Para sign-out didn't stick across refresh** (`para.tsx`). The per-row "sign out" only dropped the wagmi connector; Para's embedded/social session stayed alive and silently re-attached on the next load. Now wired `useLogout` from `@getpara/react-sdk` (re-exported via react-core) behind a `useSafeLogout` wrapper → a `logoutParaSession()` helper in `disconnect`. Called when signing out the Para account (`accountId` path, `canonicalWalletKey(walletName) === "para"`) and on a full `{ family: "all" }` disconnect; a family-scoped disconnect leaves the Para session alone. Note: Para logout is cross-tab (the reason it was previously deferred to the account modal) — acceptable for the sign-out action. **Not verified live.**
- **Fixed: first EVM account switch after load reverted** (`para.tsx`). On a fresh load with Para active, clicking MetaMask switched for a few ms then flipped back to Para; the 2nd click stuck, and a refresh reset it. Cause: during the first `switchAccount`, wagmi's _current_ connection briefly reads disconnected, the auto-reconnect effect fired `wagmiReconnect()`, and that restored the previous (Para) connection. Fix: the reconnect effect now only fires on a _truly wiped_ session (`!wagmiConnected && evmConnections.length === 0`) — during a switch the connections list stays populated — plus an `accountSwitchInFlightRef` set around `switchAccountAsync` that the effect skips on. (Still recovers the Para-session-reinit wipe it was built for, where connections go empty.) **Not verified live** — needs two real wallet extensions; confirm a single MetaMask click sticks.
- **Removed the "Active" pill and the "Switch" hover hint** (per product call). Active state still reads from the checkmark next to the name + the highlighted row border/bg; the in-progress spinner on switch is kept. With the pill gone the trailing cluster is just `[manage?] [logout]`; logout is right-anchored so it aligns across rows on its own — so the earlier `reserveManageSlot` fixed-column machinery was reverted as unnecessary. (Considered a gear on every wallet for symmetry but external wallets have no in-app management surface, so the gear would open nothing.)
- Tests: 2 new cases in `wallet-picker.test.tsx` — manage button shows for the manageable Para row but not the Phantom row and fires `openAccountUI({family:"evm"})`; hidden when `canOpenAccountUI` is false. 55 registry tests green, lint clean, typecheck clean except the pre-existing `GITHUB` error (`para.tsx:231`).
- **Not yet eyeballed live**: verify the gear renders on the Para row (not Phantom) and opens the Para account modal.

### Network selector debloat: testnet collapse + lighter rows + Command primitive (2026-06-10)

Branch `polish-multi-wallet`. `network-select.tsx` + `network-select.test.tsx` + `vitest.setup.ts`. GUI only; adapter/backend contract unchanged. Driven by "the list looks bloated" — 13 rows with testnets at full weight.

- **Collapse testnets behind a "Show testnets" toggle.** Mainnets show by default; testnets fold behind a footer toggle that advertises the hidden count ("3 hidden"). Partition is derived, not configured: `chain.testnet === true` for EVM, `cluster !== "solana:mainnet"` for SVM. Default landing view drops from 13 rows to 8. Toggle state persists to a standalone localStorage key (`aomi.network-select.show-testnets`) — kept out of `WalletPreferences` since it's a display pref, not a wallet selection. **Edge cases:** if the _active_ network is a testnet the rows stay visible and the toggle is suppressed (can't hide the network you're on); a non-empty search query also forces testnets visible so search can jump to one ("sep" → Sepolia) while collapsed.
- **Lighter rows.** Only the live network carries a filled icon chip (`bg-primary/10`); inactive rows show a bare brand mark (`text-muted-foreground`), so the list reads as one clean column instead of a stack of grey boxes.
- **Rebuilt on the `Command` (cmdk) primitive** — same as the App/Model selectors, for keyboard nav + structural consistency. Kept real chain names in rows (per the earlier "row titles keep real names" decision); did NOT shorten labels.
- **Search input is count-gated, not always-on.** Decided against a permanent search box: at ~8 branded rows it's chrome that re-bloats what we just trimmed, and logo-recognition beats typing for a small set. `CommandInput` renders only when the default (mainnet) list exceeds `SEARCH_VISIBLE_THRESHOLD` (=10) — so it stays hidden at today's scale but appears for hosts that configure many custom chains. One constant to tune (0 = always show). Search reveals testnets when active.
- **Kept intact:** connection-aware family gating (EVM-only → no SVM rows, etc.), trigger chips ("Base / Mainnet"), the destructive-SVM-switch confirm dialog, the wallet-activation guard, and the `≤1 switchable target → render null` guard (counts all targets incl. testnets).
- **Test env:** cmdk needs `ResizeObserver` + `Element.scrollIntoView`, both absent in jsdom — added no-op stubs to `vitest.setup.ts` (also unblocks future cmdk-based component tests). Reworked the 4 network-select tests for cmdk's `role="option"` items; added 2 cases (testnet hidden-by-default + toggle reveal; active-testnet keeps rows visible + suppresses toggle). 53 registry tests green, lint clean, typecheck clean except the pre-existing `GITHUB` OAuth-label error (`para.tsx:231`).
- **Not yet eyeballed live** (preview infra was flaky this session): verify the dropdown visually — testnet collapse/expand, lighter rows, trigger unchanged. Layout separation (Axis B: unified list vs two control-bar pills) was discussed and deferred — staying on the unified popover for now.

### EVM network switch killed the wallet connection (flash loop + dead switcher) (2026-06-10)

Branch `polish-multi-wallet`. Symptom: switch an EVM network once → wallet approves → EVM wallet logo + EVM network chip start flashing ~every second (off a few ms, back on) and network switching is dead until reload. Three stacked bugs in `aomi-wallet-kit`:

1. **Root cause — Para SDK rebuilt the wagmi config on every network switch** (`para.tsx`, `AomiParaProviderInner`). `resolvedWallets` was recomputed (new array identity) on each render and `paraClientConfig`/`config` were inline JSX objects. A network switch updates the network-preferences context → Inner re-renders → new `externalWalletConfig.wallets` identity → Para's `ParaProviderMin` does an identity compare (`externalWallets !== externalWalletConfig?.wallets`), pushes the array into its zustand store → `@getpara/evm-wallet-connectors` `ParaEvmProvider` sees a new wallet list → `createWagmiConfig()` from scratch → **all in-memory connections dropped** (wagmi's reconnect-on-mount doesn't re-run for a swapped config prop — mount-only effect). Fix: `useMemo` `resolvedWallets` / `paraClientConfig` / `paraConfig` (`apiKey ? {…} : null`, JSX branches on `paraClientConfig`), hoisted shared `defaultOAuthMethods` module const (a fresh `["GOOGLE"]` default array per render churned the `oAuthMethods`-keyed memos in both Inner and `AomiParaPluginProvider`).
2. **Flash oscillation — grace window restarted itself** (`evm-identity-grace.ts`). On expiry it returned `disconnectedAt: null`; the provider wrote that back to the ref, so the next render treated the still-missing address as a _fresh_ disconnect and restarted the 1.8 s grace → identity flipped cached(on) → empty(off) → cached(on) forever. That's the visible ~1 s flash of the EVM logo + chip. Fix: expired branch now preserves `disconnectedAt` so it stays expired until a live address returns. Test updated + regression test added (feed expired result back in → must stay expired).
3. **No self-heal** (`para.tsx` reconnect effect). Auto-reconnect required `paraAccount.isConnected`, so external-wallet-only sessions (MetaMask/Rabby without Para login) never recovered from an in-memory wagmi reset. Fix: reconnect now keys off `hadEvmConnectionRef && !explicitEvmDisconnectRef` (still one attempt until restored; wagmi `reconnect()` only restores storage-persisted connectors so it can't fight a deliberate disconnect). `explicitEvmDisconnectRef` declaration moved up next to the reconnect refs.
4. **Bonus race fix**: `selectNetwork`/`switchChain` set the chain preference then await `switchChainAsync`, while the align-to-preference effect _also_ fired `switchChainAsync` as soon as the preference changed (wagmi `chainId` still old) → two concurrent `wallet_switchEthereumChain` (dup popups / -32002 in some wallets). New `evmSwitchInFlightRef` set around user-initiated switches; the effect skips while set. Effect's promise also gets a `.catch` (was an unhandled rejection on user reject).
5. Typed `evmConnectionInputs` as `EvmConnectionInput[]` — fixes the `string` vs `` `0x${string}` `` tsc error the uncommitted grace wiring introduced.

51 registry tests green, lint clean, typecheck clean except the pre-existing `GITHUB` OAuth-label error (`para.tsx:231`). **Not verified live** (needs a real wallet extension): user verifying manually — load → connect → switch EVM network → no flash, switcher stays usable, repeat switches work.

### Network selector rebuild: connection-aware + unified + logos (2026-06-09)

Branch `polish-multi-wallet`. `network-select.tsx` + `network-select.test.tsx` + `icons/chains/index.tsx`. GUI only; adapter/backend contract unchanged.

- **Connection-aware gating.** Which families surface now follows what's actually _connected_ (`identity.address` for EVM, `identity.svmAddress` for SVM), not just what the host _supports_. EVM-only wallet → only EVM networks; SVM-only → only SVM; both → both. When nothing is connected it falls back to showing all supported networks so the picker doubles as a pre-connect preference. (Was: gated on supported-network counts, so it always showed both EVM+SVM tabs regardless of connection.)
- **Collapsed the EVM | Solana tab toggle into one unified list.** Single scrollable popover; when both families are present, subtle uppercase group headers (`EVM` / `SVM`) separate them. One family → no header. Matches the flat-list direction the wallet picker already landed on. Removed the `panel`/`setPanel` tab state + its reset effect + `canShowFamilyTabs`.
- **Brand logos everywhere.** Added `SolanaIcon` to `icons/chains/index.tsx` (official 3-bar mark, monochrome `currentColor`, layered opacities). SVM rows + trigger now render it; EVM rows/trigger use `getChainIcon`. The **trigger** previously had no logo (the user's main gripe — sibling Model/App selects show one): it now renders `icon + label` per shown family, joined by a `/` separator (e.g. `[Base] Base / [◎] Mainnet`). EVM chip label = chain name; SVM chip label = cluster (`Mainnet`/`Devnet`/`Testnet`), the icon carrying the family.
- **"Solana" → "SVM"** in UI chrome: group header + confirm-dialog title/body ("Switch SVM network?"). Network _row_ titles keep their real names ("Solana Mainnet" etc.).
- **Fixed first-row always looking pre-selected.** Radix auto-focuses the first row on open; `focus:bg-accent` painted it as if hovered/active. Switched to `focus-visible:` so the highlight only shows for keyboard nav, not the mouse-triggered open. `isActive && bg-accent` still marks the live network.
- **Hide guard** now counts only _visible_ (shown-family) targets — hides the selector when ≤1 switchable network is visible.
- Tests reworked: dropped the tab-click steps; added an EVM-only gating case (Solana rows absent) + a both-connected unified-list case; `createHarnessAdapter` gained `address` / `evmChains` / `solanaNetworks` overrides. 45 registry tests green, lint clean, registry typecheck clean for changed files (pre-existing `GITHUB` error in `para.tsx:222` unchanged).
- **Not yet eyeballed live**: trigger logos + connected-family gating need a real wallet connection to fully exercise (automated preview can't sign one) — user verifying via screenshots.

### Connect/wallet trigger button restyle (2026-06-09)

Branch `polish-multi-wallet`. `dual-wallet-bar.tsx` only. Iterated once on product feedback.

- **One shared button surface for both states.** Dropped the deep-black connected (`bg-primary`) state and the dashed-border disconnected state. Both now use the original `bg-muted` fill with a **solid** `border border-border` outline and `hover:bg-muted/70`, text in full `text-foreground` (was `text-muted-foreground`) so "Connect wallet" reads clearly. (First pass tried `bg-foreground/[0.05]`; reverted to muted per feedback.)
- **Connected**: active wallets render as circular brand avatars **plus the short address(es)** beside them (`formatAddress`, joined `/`). Discs are **opaque `bg-muted` with a `ring-1 ring-border` outline** and **stack** with `-ml-2` overlap — opaque so the front disc masks the one behind (a translucent fill let the back logo bleed through). Button padding tightened to `px-3.5 py-2` so more of the address fits.
- **Shared icon rendering** (`wallet-icon-slot.tsx`): the picker's `WalletIconSlot` was extracted into its own module and is now used by **both** the picker rows and the trigger avatars, so brand mark colour (`text-muted-foreground`), proportional sizing, the Phantom-art quirk, and the iconUrl/generic fallbacks are defined **once**. It takes a numeric `size` (slot px; mark scales from it via fixed ratios) + a `className` to restyle the slot (the trigger passes `rounded-full ring-1 ring-border` + stack margin; picker uses the 36px default). The trigger uses `size={28}`. This fixed the "logo colours off (esp. Phantom)" by matching the modal exactly.
- **Note**: the brand icons in `components/icons/wallets` are **monochrome** (`fill="currentColor"`), so they tint to `currentColor` — now consistently `text-muted-foreground` in both surfaces. True brand colours would need new colored SVG assets; not done (the muted-foreground look matches the approved modal).
- **Responsive disclosure (container queries).** The trigger button is now an `@container`; its content reveals more as the bar widens (fixing "button grows but text doesn't"). Each connected wallet carries a `detail` (EVM chain name via `getChainInfo`, Solana cluster via `solanaClusterLabel`). For a **single** wallet (most empty space): network `· {detail}` appears at `@[12rem]`, and the address swaps short→`longAddress` (12+8 hex) at `@[15rem]`. For **two** wallets: addresses stay short (avatars stacked), network only at `@[20rem]`. `singleWallet = connectedWallets.length === 1` drives the breakpoint choice. Breakpoints tuned for a ~15rem (w-full sidebar-footer) button — easy to nudge.
- **Not yet eyeballed live**: connected-state avatars + responsive tiers need a real wallet connection (preview can't sign one) — verify via screenshots in a real browser, and confirm/adjust the `@[...]` breakpoints against the actual sidebar width. Lint + registry typecheck clean; 13 picker tests pass.

### Wallet picker: dedup + network grouping + collapsible add-list (2026-06-09)

Branch `polish-multi-wallet`. GUI/adapter polish; backend contract unchanged. Done in two passes (same day).

Adapter (`apps/registry/src/lib/wallet-kit/`):

- **Fixed duplicate connected rows** (Rabby "take over MetaMask" / EIP-6963 impersonation). `buildAccounts` (`accounts.ts`) groups EVM connections by **lowercased address** → one row per address. Display name/`id` prefer the active connector, else a real brand over a generic "Injected" label; the row carries `connectorIds` + `chainId`. Solana deduped defensively by `publicKey`. Distinct addresses stay separate.
- **"Sign out one = sign out all" fixed** as a side effect — `disconnect({accountId})` in `para.tsx` already groups by address; correct once the display is one row per address. `para.tsx` unchanged.
- **`AomiAccount` type** (`types.ts`) gained optional `chainId` + `connectorIds`.

Picker (`wallet-picker.tsx`):

- **Connected section is one flat list** (network grouping was tried, then dropped per product feedback). Each row carries a compact **`FamilyTag`** — text "EVM"/"SVM" with a small green status dot (no chip outline) — so execution family is clear. Chain/cluster shows inline in the meta line (`0xdA6..F0 · Base`, cluster capitalized: `· Mainnet`) only when it adds info beyond the family name.
- **Switching the active wallet = click the row.** The whole row (icon + name + meta) is one button for inactive EVM accounts (chevron removed); hover highlights the card + reveals a "Switch" hint, a spinner shows while switching, and the "Active" pill fades in. Disconnect stays a separate icon button beside it. Solana/active rows render as a static (non-clickable) row.
- **Section order when connected:** Connected → Quick sign-in → Add wallet; disconnected keeps Quick sign-in on top.
- **Collapsible "Add another wallet"** expander in the connected state (brand rows hidden until expanded, smooth grid-rows transition); collapses again after a direct link. Disconnected keeps the brand grid visible for onboarding.
- **Add-list is grouped by family** (EVM rows, hairline separator, Solana rows, hairline, multichain/"More" at the bottom) so a dual-chain wallet like Phantom appearing on both chains doesn't read as a duplicate.
- **Already-connected brands filtered** from the add-list, **family-scoped** (a connected EVM Phantom hides the EVM add row but leaves its Solana entry connectable).
- **Family-aware dedup** of add options (`walletFamilyAliasKey`) so a dual-chain wallet like **Phantom is reachable on both EVM and Solana** (previously its Solana entry was collapsed away by brand-only dedup — that's why Phantom only ever connected as EVM).
- **Direct connect/switch keeps the picker open** (no success banner, no forced close — the new wallet just lands in the connected list). Only external handoffs (WalletConnect / full Para list, via `isExternalHandoff`) close the picker so their own surface can take over.
- **Social section is context-aware:** label "Quick sign-in" (disconnected) → "Link additional accounts" (connected); row subtitle adapts to "Add an Aomi account" when connected.
- Solana cluster label is capitalized in the row meta (`· Mainnet`). The "Account" header pill kept as-is (per product decision).

Tests: `accounts.test.ts` (9 dedup cases) + `wallet-picker.test.tsx` (13 cases: grouping, collapsed/expanded add-list, connected-brand filtering, success state, dual-chain Phantom reachability, DOM order). Full registry suite green (44 tests). Registry typecheck clean for changed files (pre-existing unrelated `GITHUB`/`X` OAuth error in `para.tsx:222`, flagged separately). Lint clean.

- **Not yet eyeballed live**: connected-state visuals need real Rabby/MetaMask/Phantom extensions (automated preview can't install them) — verify via screenshots in a real browser.

### Account token-exchange runtime wiring + test coverage (2026-06-08)

Branch `codex/para-solana-support-wip` (PR #150). Merged `fix/pr150-runtime-wiring` (commit "Wire account token exchange into runtime") after review: builds, dist in sync, 26 runtime tests, portal typecheck clean.

- **Reviewed & verified adaptation** of the FE↔backend contracts: `createAccountAccessTokenProvider` → `POST /api/account/sessions/exchange` (`{ provider, provider_token }` ↔ backend `ExchangeAccountSessionRequest`), and `app` on `sendSystemMessage` → `/api/system` (backend merges query + JSON body via `select_system_params`). Both correct.
- **Removed dead `ThreadContextTest.tsx`** debug component (referenced removed `threads`/`threadMetadata`; failed `tsc --noEmit`, not caught by CI). Registry typecheck now clean.
- **FE unit coverage**: `packages/client/test/account-session.unit.test.ts` — caching, forceRefresh, single in-flight coalescing, proactive timer refresh + subscriber notify, dispose teardown, snake_case mapping (7 tests).
- **Live e2e**: `client.integration.test.ts` gained an LLM-free app-scoped system-message test (green vs local backend :8080 + local supabase).
- **Backend DB e2e** (product-mono, branch `test/account-exchange-db-e2e`): `entities.rs` test mirroring the exchange's Privy identity resolution + provider scoping (green vs local supabase :54322).
- **Known gap (flagged, no code)**: backend `ScheduledIntentDueEvent` (`scheduled_intent_due`, declared System→UI) from product-mono #564 has no FE handler — falls through as a raw system message. Product decision needed.

### Multi-wallet per-family connection + hybrid picker (2026-05-29)

Branch `codex/para-solana-support-wip`. Design/plan in `docs/superpowers/specs/2026-05-29-multiwallet-per-family-picker-design.md` and `docs/superpowers/plans/2026-05-29-multiwallet-per-family-picker.md`. Backend contract unchanged.

- **Default Solana cluster → mainnet** (was devnet) in `landing-para-provider.tsx`, `landing-privy-provider.tsx`, `portal/wallet-providers.tsx`.
- **Account registry**: `AomiAccount` type + `accounts`/`selectAccount` on `AomiWalletKit`; `disconnect({accountId})` for per-account EVM disconnect (`types.ts`, new `accounts.ts` with `buildAccounts`/`isAccountSelectable` + tests).
- **Persistence**: new `persistence.ts` (localStorage wallet prefs) wired into `network-preferences.tsx` (read-once `useState` init + save effect, `storageKey="para"`). `vitest.setup.ts` gained a localStorage polyfill + `IS_REACT_ACT_ENVIRONMENT`. Deviation from spec: persists selection only (family/chain/network), not active account — wagmi/solana-adapter restore their own active connection.
- **wagmi multi-connection**: `safe-wagmi-hooks.ts` gained `useSafeConnections`, `useSafeSwitchAccount`, and `WagmiConfigShape.connectors`.
- **para.tsx**: builds `accounts` from wagmi connections + Solana wallet; `selectAccount` → wagmi `switchAccount`; per-account EVM disconnect; EVM-connect guard (keys off `wagmiAddress`) so "Connect EVM" no longer reopens the Para modal when already connected. base-account/privy/context + network-select test mock got minimal `accounts:[]`/`selectAccount` conformance.
- **Hybrid picker**: new `wallet-picker-context.tsx` + `wallet-picker.tsx` (Para provider row + EVM/Solana family sections, inactive family greyed with "Switch to X" affordance, select/disconnect/connect). `dual-wallet-bar.tsx` rewritten to a trigger that opens the picker. Deleted `wallet-family-slot.tsx` (+ its public export).

### Registry app metadata crash guard (2026-05-27)

- **Fixed control bar crash on malformed app ids** in `apps/registry/src/components/control-bar/app-metadata.ts` by:
  - making `normalizeAppId` accept unknown values and safely return an empty string for non-strings
  - adding a fallback `Unknown App` metadata entry for empty/invalid ids
  - skipping invalid entries in `groupAppsByCategory` before calling `getAppInfo`
  - normalizing returned `AppInfo.id` values for consistent icon/selection behavior
- **Added regression test** `apps/registry/src/components/control-bar/app-metadata.test.ts` to verify non-string ids no longer crash grouping and empty ids resolve to fallback metadata

### Release version bumps for publish (2026-04-27)

- **Bumped package versions** for the three publish targets:
  - `@aomi-labs/client`: `0.1.28` -> `0.1.29`
  - `@aomi-labs/react`: `0.3.12` -> `0.3.13`
  - `@aomi-labs/widget-lib`: `1.2.8` -> `1.2.9`
- **Updated files:** `packages/client/package.json`, `packages/react/package.json`, `apps/registry/package.json`

### CLI root-shape alignment with Rust CLI (2026-04-19)

- **Added root chat mode** to `packages/client/src/cli/root.ts` + new `src/cli/repl.ts`:
  - `aomi` now starts an interactive REPL by default
  - `aomi --prompt "<message>"` sends a single prompt and exits
- **Added REPL commands** matching the backend CLI shape: `/heap`, `/app`, `/model`, `/key`, and `:exit`
- **Added provider-key support** to the TS CLI:
  - new `src/cli/commands/provider-keys.ts`
  - new `AomiClient` methods for `GET/POST/DELETE /api/control/provider-keys`
- **Kept noun-verb operator subcommands** (`tx`, `session`, `secret`, `model`, `app`, `chain`) for wallet/session workflows instead of removing them
- **Added unit coverage** in `test/cli/cli-provider-keys.unit.test.ts` and `test/cli/cli-repl.unit.test.ts`

### AA Proxy: Delete client-side complexity (2026-04-12)

- **Deleted 8 source files (~871 lines):** `cli/aa-config.ts`, `cli/commands/aa.ts`, `cli/commands/defs/aa.ts`, `aa/env.ts`, `aa/alchemy/env.ts`, `aa/pimlico/env.ts`, `aa/alchemy/resolve.ts`, `aa/resolve.ts`
- **Deleted 3 test files:** `aa-env.unit.test.ts`, `aa-resolve.unit.test.ts`, `cli-aa-config.unit.test.ts`
- **Rewrote `cli/execution.ts`** (285→170 lines) — removed `getCliAAApiKey()`, `getCliAlchemyGasPolicyId()`, `isCliProviderConfigured()`, `resolveAAProvider()`, `resolveAAMode()`, all `readAAConfig()` calls. New 3-way decision: `--eoa` → EOA, `PIMLICO_API_KEY` + pimlico → Pimlico BYOK, `ALCHEMY_API_KEY` → Alchemy BYOK, else → Alchemy proxy (zero-config default)
- **Added proxy transport to `aa/alchemy/create.ts`** — `proxyBaseUrl` param threaded through `CreateAlchemyAAStateOptions` → `createAlchemyWalletApisState`. Transport selection: `proxyBaseUrl ? alchemyWalletTransport({ url }) : alchemyWalletTransport({ apiKey })`
- **Threaded `proxyBaseUrl` through `aa/create.ts`** — `CreateAAStateOptions` and `createAAProviderState` pass through to Alchemy creator
- **Moved `AAProvider` type** from deleted `aa/env.ts` to `aa/types.ts`
- **Inlined env reads** — `pimlico/resolve.ts` uses `process.env.PIMLICO_API_KEY` directly (was `readEnv(PIMLICO_API_KEY_ENVS)`)
- **Inlined `alchemy/provider.ts`** — replaced `resolveAlchemyConfig` dependency with local `resolveForHook()` using `getAAChainConfig` + `buildAAExecutionPlan` + `NEXT_PUBLIC_*` env vars
- **Added `ALCHEMY_CHAIN_SLUGS`** to `src/chains.ts` — maps chain IDs to Alchemy network slugs for proxy URL construction
- **Deleted `parseAAConfig()`** (~75 lines) from `aa/types.ts` — along with `assertChainConfig()` and `isObject()` helpers
- **Removed `aomi aa` subcommand** from `cli/root.ts` — no more `aomi aa status/set/test/reset` commands
- **Updated `src/index.ts`** — removed exports for deleted symbols (`parseAAConfig`, `readEnv`, `isProviderConfigured`, `resolveDefaultProvider`, `resolveAlchemyConfig`, `AlchemyResolveOptions`, `AlchemyResolvedConfig`)
- **Updated barrel files** — `aa/index.ts`, `aa/alchemy/index.ts`, `aa/pimlico/index.ts` trimmed to match remaining modules
- **Rewrote `test/cli-execution.unit.test.ts`** — removed persisted-config tests, added proxy-mode tests (zero-config → `proxy: true`), added BYOK tests, added proxy URL assertion
- **Updated `test/aa-create.unit.test.ts`** — pass `apiKey` explicitly (no longer read from env by create function)
- All 155 tests pass, build clean, lint clean

#### New execution model

| Env vars          | Flag                    | Result                                  |
| ----------------- | ----------------------- | --------------------------------------- |
| (none)            | (none)                  | **AA proxy** (zero-config, via backend) |
| `ALCHEMY_API_KEY` | (none)                  | AA BYOK (Alchemy direct)                |
| `PIMLICO_API_KEY` | `--aa-provider pimlico` | AA BYOK (Pimlico direct)                |
| any               | `--eoa`                 | EOA                                     |

### Phase 5: Cleanup legacy code (2026-04-12)

- **Deleted `src/cli/args.ts`** — hand-rolled `parseArgs()` + `getConfig()` parser fully replaced
- **Removed `ParsedArgs` and `CliRuntime` types** from `types.ts` — `CliConfig` is the single config type
- **`buildCliConfig(args)` in `shared.ts`** — single source of truth for CLI config, reads citty's typed args + env vars directly (no re-parsing `process.argv`)
- **Extracted `src/chains.ts`** — `SUPPORTED_CHAIN_IDS`, `CHAIN_NAMES` (from deleted `args.ts`)
- **Extracted `src/cli/validation.ts`** — `parseChainId`, `normalizePrivateKey`, `parseAAProvider`, `parseAAMode` (from deleted `args.ts`)
- **All handler functions** take `CliConfig` directly (no more `runtime.config` destructuring)
- **All def files** use `buildCliConfig(args)` instead of `toCliRuntime()`
- **Updated `commands/aa.ts`** import — `CHAIN_NAMES`/`SUPPORTED_CHAIN_IDS` from `../chains` (was `../args`)
- **Updated test files** — `cli-execution.unit.test.ts` uses `buildCliConfig()`, `cli-session.unit.test.ts` passes `CliConfig` directly, `cli-wallet-sign.unit.test.ts` passes `(config, txIds)` signature
- All 188 tests pass, build clean

### Phase 4: Flatten AA execution (2026-04-12)

- **Removed `"auto"` execution mode** from `CliExecutionMode` — now `"aa" | "eoa"` only
- **Removed `fallbackToEoa`** from `CliExecutionDecision` — AA either works or fails, no silent cascading
- **Deleted `executeTransactionWithFallback()`** (~100 lines) from `wallet.ts` — the 3-layer sponsored→unsponsored→EOA cascade
- **Simplified `resolveCliExecutionDecision()`** from ~80 lines to ~15 lines — just checks if provider is configured
- **Simplified `resolveAAProvider()`** — removed `required` parameter, always throws on missing config when AA requested
- **Removed `sponsored` parameter** from `createCliProviderState()` — no more sponsorship retry logic
- **Removed `isAlchemySponsorshipLimitError` re-export** from `execution.ts` — no longer needed by CLI
- **Updated `resolveExecutionMode()` in `args.ts`** — default is `"eoa"`, `--aa`/`--aa-provider`/`--aa-mode` set `"aa"`
- **Removed sign-flag command guard** from `getConfig()` — citty handles command routing now
- **Exported `CliExecutionDecision` type** from `execution.ts` for external use
- **Updated `tx.ts` defs** — refreshed flag descriptions for `--aa` and `--eoa`
- **Fixed `cli-session.unit.test.ts`** — updated to use `newSessionCommand` (pre-existing break from umbrella removal)
- **Updated all test expectations** — removed `fallbackToEoa`, changed `"auto"` to `"aa"`/`"eoa"`, fixed `sponsored` params
- **Updated `specs/AA-ARCH.md`** — CLI flow, decision type, single-shot sign, `fallback` field vs signing, `--aa-provider` / `--aa-mode` as AA triggers, `executeWalletCalls` + `fallbackToEoa` note for widget vs CLI
- **Made `execution` optional in `CliConfig`** — `undefined` means auto-detect (AA if configured, else EOA)
- **`resolveExecutionMode` returns `undefined`** when no `--aa`/`--eoa` flag (was returning `"eoa"`)
- **`resolveCliExecutionDecision` handles `undefined`** — checks if provider configured, uses AA automatically
- **Added `getAlternativeAAMode()`** — returns the other mode (7702↔4337) for fallback
- **Added mode fallback in `signCommand`** — tries preferred mode, if fails tries alternative, if both fail: hard error with `--eoa` suggestion
- All 189 tests pass, build clean

#### Execution model

| AA configured? | Flag    | Result                                      |
| -------------- | ------- | ------------------------------------------- |
| Yes            | (none)  | **AA automatically** (7702 → 4337 fallback) |
| Yes            | `--aa`  | AA required, same fallback                  |
| Yes            | `--eoa` | EOA, skip AA                                |
| No             | (none)  | EOA                                         |
| No             | `--aa`  | Error: "configure AA first"                 |

### Spec: AA-ARCH.md refresh (2026-04-11)

- **Updated `specs/AA-ARCH.md`** to match current `packages/client/src/aa/` layout (`alchemy/` and `pimlico/` subpackages, `owner.ts`, dynamic SDK imports in provider `create.ts` files), CLI persistence (`~/.aomi/aa.json`, `aomi aa`, `aomi tx sign`), `AAState` naming, ERC-20 + 4337 mode override, and flattened CLI sign path (no sponsorship/EOA cascade).

### CLI Refactor: citty + noun-verb + AA config (2026-04-11)

- **Adopted citty** as CLI framework, replacing hand-rolled `switch` dispatcher
- **New file `src/cli/root.ts`** — root `defineCommand` with noun-verb subcommands tree
- **New directory `src/cli/commands/defs/`** — citty `defineCommand` wrappers for each noun:
  - `chat.ts`, `tx.ts` (list/simulate/sign), `session.ts` (list/new/resume/delete/status/log/events/close), `model.ts` (list/set/current), `app.ts` (list/current), `chain.ts` (list), `secret.ts` (list/clear/add), `aa.ts` (status/set/test/reset)
- **New file `src/cli/commands/defs/shared.ts`** — global args definition + `toCliRuntime()` bridge adapter
- **New file `src/cli/aa-config.ts`** — persistent AA config in `~/.aomi/aa.json`
- **New file `src/cli/commands/aa.ts`** — AA config command handlers
- **Modified `src/cli/main.ts`** — replaced `main()` switch + `printUsage()` with `runMain(root)` from citty
- **Removed legacy aliases** — no more `aomi sign`, `aomi log`, etc. at top level; use `aomi tx sign`, `aomi session log`
- **Removed umbrella routing** — deleted `sessionCommand`, `modelCommand`, `appCommand`, `chainCommand`, `secretCommand`; defs call leaf handlers directly
- **Extracted leaf handlers** — `newSessionCommand`, `resumeSessionCommand`, `deleteSessionCommand`, `currentAppCommand`, `currentModelCommand`, `setModelCommand`, `listSecretsCommand`, `clearSecretsCommand`
- **Deleted `createRuntime`** from `args.ts`

#### Command surface

```
aomi chat <message>                 Send a message
aomi tx list                        List transactions
aomi tx simulate <id>...            Simulate batch
aomi tx sign <id>...                Sign and submit
aomi session list|new|resume|delete|status|log|events|close
aomi model list|set|current
aomi app list|current
aomi chain list
aomi secret list|clear|add
aomi aa status|set|test|reset
```

### Landing `content/components` + resolve aliases (2026-04-03)

- **Moved** interactive docs-only UI from `apps/landing/src/components/` to **`apps/landing/content/components/`** (playground, samples, **`examples/`** (API consoles + collapsible demos), layout). Collapsible demo, playground, and widget demo use **`backendUrl = "/"`** (same-origin proxy).
- **`app/mdx-components.tsx`** — playground/samples from `@/content/components/...`; sessions/system consoles from **`@/components/examples/...`**.
- **`apps/landing/next.config.ts`** — `@/components` → **`apps/registry/src/components`**; **`@/components/examples`** → **`content/components/examples`** (must precede `@/components` in alias maps); **`@/content`** → `./content`.
- **`apps/landing/tsconfig.json`** — **`@/components/examples/*`** → `./content/components/examples/*` (before `@/*`); **`@/content/*`** → `./content/*`.
- **`content/examples/*.mdx`** — API console imports use **`@/components/examples/...`** (former `api-console/` folder removed; files live next to `aomi-frame-collapsible`, etc.).
- **Guide MDX** uses `@/components/...` for widget UI → **registry**, except **`@/components/examples/*`** → **content** examples.
- **Deleted `apps/landing/src/mdx-provider.tsx`** — unused stub; MDX uses **`app/mdx-components.tsx`**.

### Aomi wallet adapter rename (2026-04-03)

- **`apps/registry/src/lib/wallet-adapter.ts` → `aomi-wallet-kit.ts`** — wallet kit exports now use the `AomiWalletKit*` naming surface consistently.
- **Registry** — item `wallet-adapter` renamed to **`aomi-wallet-kit`**; install URL is now `https://aomi.dev/r/aomi-wallet-kit.json` (rebuilt `apps/registry/dist/` → `apps/landing/public/r/`).
- **`apps/registry/scripts/build-registry.js`** — clears `dist/` before writing so renamed/removed registry items do not leave stale `*.json` artifacts.

### Landing cleanup (2026-04-03)

- **Deleted `apps/landing/src/components/wallet-providers.tsx`** — unused; hero uses `LandingParaProvider` instead.
- **Deleted `apps/landing/src/components/config.tsx`** — only imported by the removed wallet providers file.

### Registry file renames (2026-04-03)

- **`control-bar/wallet-connect.tsx` → `connect-button.tsx`** — public surface is now `ConnectButton` / `ConnectButtonProps`.
- **`wallet-tx-handler.tsx` → `runtime-tx-handler.tsx`** — public surface is now `RuntimeTxHandler`. Registry item slug **`wallet-tx-handler` → `runtime-tx-handler`** (shadcn URL is now `https://aomi.dev/r/runtime-tx-handler.json`).
- **`apps/registry/src/registry.ts`** — updated `control-bar` file list, `aomi-frame` registry dependency, and runtime handler entry.
- **Rebuilt `apps/registry/dist/`** and synced to `apps/landing/public/r/`.

### Wallet Bridge Architecture (2026-04-03)

- **New file `apps/registry/src/lib/wallet-kit.ts`** — extracted `AomiWalletKit`, `AomiWalletKitContext`, `AOMI_SESSION_DISCONNECTED_IDENTITY`, `AomiWalletKitContextProvider`, and `useAomiWalletKit()`.
- **New file `apps/landing/app/components/landing-wallet-kit-bridge.tsx`** — `LandingWalletKitBridge` runs inside the Para provider tree, reads wagmi + Para auth hooks, and writes `AomiWalletKitContext`.
- **New file `apps/landing/app/components/landing-para-provider.tsx`** — `LandingParaProvider` wraps `ParaProvider` + `LandingWalletKitBridge` with all Para SDK config (apiKey, env, chains, wallets, oAuth).
- **Modified `apps/registry/src/components/aomi-frame.tsx`** — removed `AomiWalletKitContextProvider` wrapper and `adapter` prop from `Root`. Widget now reads from `AomiWalletKitContext` provided by an ancestor bridge.
- **Modified `apps/landing/app/sections/hero.tsx`** — wrapped `AomiFrame.Root` with `LandingParaProvider`.
- **Modified consumer imports** — `connect-button.tsx`, `runtime-tx-handler.tsx`, `network-select.tsx`, `account-identity.ts` now import from `lib/wallet-kit` (relative paths).
- **Updated `apps/registry/src/index.ts`** — exports the `AomiWalletKit*` wallet kit and identity surface.
- **Updated `apps/registry/src/registry.ts`** — replaced `aomi-adapter-provider` entry with `aomi-wallet-kit` + `aomi-auth-sync-bridge` entries.
- **Deleted `apps/registry/src/components/aomi-adapter-provider.tsx`** — replaced by `lib/wallet-kit.ts`.
- **Deleted `apps/registry/src/components/para-plugin-provider.tsx`** (564 lines) — replaced by the host-side `LandingWalletKitBridge` + `LandingParaProvider`.
- **Modified `apps/registry/package.json`** — removed `@getpara/react-sdk`, `@getpara/react-core`, `@getpara/evm-wallet-connectors` from deps; added `@getpara/react-sdk` as optional peer dep.
- **Fixed Para modal not opening** — `ParaProviderMin` gates both children AND `ParaModal` behind `isReady` (which never fires due to Zustand store duplication). Fix: render `ParaModal` outside `ParaProviderMin` wrapped in `ParaProviderCore` (from `@getpara/react-core/internal`) with `waitForReady: false` + `AuthProvider` (from `@getpara/react-sdk-lite` internal dist, accessed via turbopack alias `@para-internal/auth-provider`). This provides both `CoreStoreContext` and `AuthContext` that `ParaModal` requires for OAuth/phone/wallet auth flows. Added corresponding turbopack + webpack aliases in `next.config.ts`.

### AA Consolidation (2026-03-22)

- **New files in `packages/client/src/aa/`:**
  - `env.ts` — unified env var reading (`readEnv`, `readGasPolicyEnv`, `isProviderConfigured`, `resolveDefaultProvider`) with `publicOnly` flag for browser-safe vs CLI usage
  - `adapt.ts` — `adaptSmartAccount()` (bridges `@getpara/aa-*` SDK shapes to `AALike`), `isAlchemySponsorshipLimitError()`, `ParaSmartAccountLike` type
  - `resolve.ts` — `resolveAlchemyConfig()` and `resolvePimlicoConfig()` with `modeOverride`, `publicOnly`, `throwOnMissingConfig` options
  - `create.ts` — `createAAProviderState()` async smart account creation (only file importing `@getpara/aa-alchemy`/`@getpara/aa-pimlico`)
- **Refactored `src/aa/alchemy.ts`** — removed private `resolveAlchemyProviderConfig()` and `readPublicEnv()`, now delegates to `resolveAlchemyConfig({ publicOnly: true })`
- **Refactored `src/aa/pimlico.ts`** — same treatment, delegates to `resolvePimlicoConfig({ publicOnly: true })`
- **Simplified `src/cli/execution.ts`** — deleted ~200 lines of duplicated AA logic (`ParaSmartAccountLike`, `readFirstEnv`, `isProviderConfigured`, `resolveDefaultProvider`, `resolveAAProvider`, `resolveAAPlan`, `adaptSmartAccount`, `createAlchemyProviderState`, `createPimlicoProviderState`, `isAlchemySponsorshipLimitError`). Now delegates to `../aa` for all AA operations.
- **Updated `src/aa/index.ts`** — added exports for env, adapt, resolve, create modules
- **Updated `src/index.ts`** — added public API exports for new AA symbols
- **New test files:** `aa-env.unit.test.ts`, `aa-adapt.unit.test.ts`, `aa-resolve.unit.test.ts`, `aa-create.unit.test.ts`
- All 79 tests pass, library builds, lint clean

### Docs Directory Restructure Phase 7 (2026-03-04)

- **Sub-task A: Dedup reference pages**
  - Removed `### Message Processing` sequence diagram section from `reference/architecture.mdx` (duplicates `build/how-it-works.mdx`)
  - Removed `ChatAppBuilder` flowchart mermaid block from `reference/sdk.mdx` (duplicates `build/building-apps.mdx`)
- **Sub-task B: Updated routing and nav files**
  - Changed default redirect in `app/docs/[[...slug]]/page.tsx` from `/docs/getting-started/overview` to `/docs/build/overview`
  - Updated all 16 legacy redirects to point to new `/docs/build/` and `/docs/use-aomi/` paths
  - Added 19 new redirects for restructured paths (getting-started/_, core-concepts/_, integration/_, telegram/_)
  - Updated both `navLinks` and `navTabs` in `layout-config.tsx` to `/docs/build/overview`
- **Sub-task C: Updated internal links across all documentation pages**
  - Updated links in 8 persistent `.mdx` files: namespaces, api-reference, sessions, widget/configuration, reference/runtime, headless/runtime-provider, headless/install, widget/aomi-frame
  - All `/docs/core-concepts/*` links → `/docs/build/*`
  - All `/docs/getting-started/*` links → `/docs/build/*`
  - All `/docs/integration/*` links → `/docs/build/*`
  - All `/docs/guides/integration/*` links → `/docs/build/*`
  - All `/docs/guides/telegram/*` links → `/docs/use-aomi/telegram/*`
- **Sub-task D: Deleted old directories and files**
  - Deleted 13 files via `git rm`: getting-started/{overview,for-businesses,quickstart,meta.json}, core-concepts/{how-it-works,meta.json}, integration/{overview,meta.json,widget/install,widget/meta.json,headless/meta.json}, telegram/{overview,meta.json}
  - Removed 6 empty directories: getting-started/, core-concepts/, integration/widget/, integration/headless/, integration/, telegram/

### Docs Directory Restructure Phase 6 (2026-03-04)

- Created `apps/landing/content/guides/use-aomi/overview.mdx` -- Getting Started page for end users (what Aomi assistants are, chat experience, threads, wallet, where to use)
- Created `apps/landing/content/guides/use-aomi/web-chat.mdx` -- Web Chat guide (sending messages, streaming, tool calls, thread management, control bar, wallet connection, tips)
- Created `apps/landing/content/guides/use-aomi/telegram/overview.mdx` -- Telegram Bot overview rewrite (rewrote existing `telegram/overview.mdx` for end users, removed architecture diagram and panel router internals, added Getting Started section, links to sub-pages)
- Created `apps/landing/content/guides/use-aomi/faq.mdx` -- FAQ page (8 questions: tool calls, wallet safety, wallet-optional usage, models, threads, refusals, reporting problems, data access)
- All 4 pages already listed in existing `use-aomi/meta.json` from Phase 1

### Docs Directory Restructure Phase 5 (2026-03-04)

- Moved `core-concepts/building-apps.mdx` to `build/building-apps.mdx` via `git mv`
- Edited `building-apps.mdx`: removed AomiTool trait table and AomiBackend trait code block/paragraph (SDK overlap)
- Added SDK Reference callout notes where trait details were removed
- Updated Next Steps links to `/docs/build/` and `/docs/reference/` paths
- Moved `telegram/admin.mdx` to `build/telegram-bot.mdx` via `git mv`
- Reframed as "Telegram Bot Setup" for developers deploying the bot for their product
- Updated frontmatter (title: "Telegram Bot Setup", description: "Configure and deploy the Telegram bot for your product.")
- Reframed intro, section headers (Development/Production), added Next Steps with `/docs/build/` links
- Already listed in `build/meta.json` at correct positions

### Docs Directory Restructure Phase 4 (2026-03-04)

- Created `apps/landing/content/guides/build/how-it-works.mdx` by merging:
  - `core-concepts/how-it-works.mdx` (technical pipeline: mermaid diagrams, endpoint table, sequence diagram, SSE format, step-by-step walkthrough, "What Aomi Manages" table)
  - `getting-started/for-businesses.mdx` (narrative tone, "What MyCoinDex Gets" summary table, integration code snippets)
- Structural base: `how-it-works.mdx` (better technical flow with pipeline + sequence diagrams)
- Absorbed from `for-businesses.mdx`: narrative opening tone, capability summary table
- Merged "What MyCoinDex Gets" and "What Aomi Manages" into single "What You Get" table with Capability/Details/Managed By columns
- Removed: Step 6 "Integrate Into Your Product" (covered by quickstart and widget/headless pages), duplicated 4-endpoint API table (kept 5-endpoint version), duplicated preamble/model sections
- Added SSE event types table alongside the existing stream format code block
- All Next Steps links updated to `/docs/build/` paths
- Already listed in `build/meta.json` at position 3

### Docs Directory Restructure Phase 3 (2026-03-04)

- Created `apps/landing/content/guides/build/quickstart.mdx` by merging:
  - `getting-started/quickstart.mdx` (end-to-end quickstart flow: prereqs, install, env vars, add to page, configure API key, run, customizing layout)
  - `integration/widget/install.mdx` (what gets installed file tree, registry architecture, namespace configuration, updating components)
- Absorbed "What Gets Installed" (npm packages + file tree), "Registry Architecture" (three sources table + diagram), "Namespace Configuration" (shorthand via components.json), "Updating Components" (--overwrite + git diff)
- Collapsed "Philosophy" section into single sentence in Registry Architecture section
- Merged "Run Your App" and "What You Should See" into one section
- All Next Steps links updated to `/docs/build/` paths
- Already listed in `build/meta.json` at position 2

### Docs Directory Restructure Phase 2 (2026-03-04)

- Created `apps/landing/content/guides/build/overview.mdx` by merging:
  - `getting-started/overview.mdx` (What is Aomi framing, How It Works diagram, Key Features, Platform Support)
  - `integration/overview.mdx` (Widget vs Headless comparison, Shared Foundation, Choosing a Path)
- Merged two separate integration path tables into a single comprehensive 3-column comparison (Widget, Headless, Telegram)
- Developer-focused tone, removed end-user-facing language
- All links updated to new `/docs/build/` paths

### Docs Directory Restructure Phase 1 (2026-03-04)

- Created new directory structure under `apps/landing/content/guides/`:
  - `use-aomi/` and `use-aomi/telegram/`
  - `build/`, `build/widget/`, `build/headless/`
- Moved 15 unchanged pages via `git mv`:
  - 4 widget files: `integration/widget/` -> `build/widget/`
  - 4 headless files: `integration/headless/` -> `build/headless/`
  - 3 core-concepts files: `core-concepts/{namespaces,sessions,api-reference}.mdx` -> `build/`
  - 1 integration file: `integration/wallet-integration.mdx` -> `build/`
  - 3 telegram files: `telegram/{commands,panels,wallet}.mdx` -> `use-aomi/telegram/`
- Created 5 new `meta.json` files: `use-aomi/`, `use-aomi/telegram/`, `build/`, `build/widget/`, `build/headless/`
- Updated root `meta.json` with new two-section layout (Use Aomi / Build with Aomi)
- Old directories preserved (remaining files handled in later phases)
- No file content modified (link updates happen in later phases)

### Playground Theme Customizer & Radius Unification (2026-03-03)

- **Theme customizer** added to `/playground/configurator` as a "Theme" tab alongside "Layout"
  - 12 curated presets (Default, Modern Minimal, Violet Bloom, Ocean Breeze, Claude, Cyberpunk, Midnight Bloom, Catppuccin, Nature, Amber Minimal, Supabase, Mono)
  - Light/dark mode toggle (scoped to preview only via `.dark` class)
  - Radius slider (0–2rem) controlling all widget border-radius tokens
  - Collapsible color overrides with native color pickers
  - Generated Theme CSS export (`:root` + `.dark` blocks with OKLCH values)
- **New files**: `lib/color-convert.ts`, `lib/theme-presets.ts`, `lib/theme-utils.ts`, `src/components/playground/ThemeCustomizer.tsx`
- **Modified**: `PlaygroundConfigurator.tsx` — tabbed config (Layout|Theme) + tabbed code output (JSX|CSS)

#### Radius unification refactor

- **`default.css`** — extended `@theme inline` with `--radius-2xl`, `--radius-3xl`, `--radius-4xl` tokens (calc offsets from `--radius`)
- **`theme-utils.ts`** — `themeToStyleObject` now sets all 7 radius tokens (`sm` through `4xl`) as inline style overrides
- **`thread-list.tsx`** — "New Chat" button and thread list items changed from `rounded-full` → `rounded-3xl`
- **`connect-button.tsx`** — account connect button changed from `rounded-full` → `rounded-3xl`
- **`attachment.tsx`** — attachment tiles changed from `rounded-[14px]` → `rounded-xl`
- Components using `rounded-3xl`/`rounded-4xl` (suggestion cards, composer, frame wrapper) now automatically use the new tokens
- `rounded-full` kept on intentionally circular elements (send/cancel buttons, avatars, control bar pills)

### Landing Page — DeFi & X API Consoles (2026-03-01)

- **`DefiConsole.tsx`** — 9 accordion endpoints covering DefiLlama (prices, yields, protocols, chain TVL, bridges), 0x swap quotes, LI.FI cross-chain quotes, and CoW Protocol (quote + order submission)
- **`XConsole.tsx`** — 5 accordion endpoints for X API v2: user lookup, user posts, search, trends, and single post retrieval. All require Bearer token auth.
- **`defi-aggregators.mdx`** — replaced stub with intro text + `<DefiConsole />`
- **`x-apis.mdx`** — replaced stub with intro text + `<XConsole />`
- **`app/api/proxy/route.ts`** — expanded CORS proxy allowlist with DefiLlama hosts (`coins.llama.fi`, `yields.llama.fi`, `api.llama.fi`, `bridges.llama.fi`), aggregator hosts (`api.0x.org`, `li.quest`, `api.cow.fi`), and X API (`api.x.com`)
- **`ApiDrawer.tsx`** — normalized vertical padding (`py-3`) across description, URL bar, and response header sections

### Thread-Scoped Control State (2026-02-02)

- **`ThreadMetadata`** now includes a `control` field with `ThreadControlState`
- **`ThreadControlState`** stores per-thread control configuration:
  - `model: string | null` - selected model for this thread
  - `namespace: string | null` - selected namespace for this thread
  - `controlDirty: boolean` - whether control changed but chat hasn't started
  - `isProcessing: boolean` - whether thread is currently generating (disables controls)
- Model/namespace selections are now **thread-scoped** - switching threads restores previous selections
- `isProcessing` wired from orchestrator → thread metadata → control context → UI components
- Control dropdowns disabled while assistant is generating

### Control Context API Updates

- Removed `isProcessing` prop (now derived from thread metadata)
- Added `getCurrentThreadControl()` to get current thread's control state
- Added `onNamespaceSelect(namespace)` for per-thread namespace changes
- `onModelSelect(model)` now updates thread metadata + calls backend
- Added `markControlSynced()` to clear dirty flag after chat starts
- Global state: `apiKey`, `availableModels`, `authorizedNamespaces`, `defaultModel`, `defaultNamespace`
- Per-thread state: `model`, `namespace`, `controlDirty`, `isProcessing` (in ThreadMetadata)

### Control Context Refactor (2025-01-30)

- Added `ControlContextProvider` for model/namespace/apiKey management
- Model selection is backend-only via `onModelSelect(model)` - not stored in global client state
- Auto-fetches namespaces on mount and when apiKey changes
- ApiKey persisted to localStorage automatically
- Added Control API to `AomiClient`: `getNamespaces()`, `getModels()`, `setModel()`

### Control Bar Components

- `ModelSelect` - reads model from thread control state, calls `onModelSelect()` on selection
- `NamespaceSelect` - reads namespace from thread control state, calls `onNamespaceSelect()` on selection
- `ApiKeyInput` - uses `setApiKey()` for updates
- Both disabled when `isProcessing` is true

### Runtime Modularization

- Split `aomi-runtime.tsx` into shell (50 lines) + `core.tsx` (runtime logic)
- Extracted `threadlist-adapter.ts` for thread list operations
- `orchestrator.ts` now receives `aomiClient` instance instead of URL
- `ControlContextProvider` receives `getThreadMetadata` and `updateThreadMetadata` from thread context
- Core syncs `isRunning` → `threadMetadata.control.isProcessing`

### Event System

- Added `EventContextProvider` for inbound/outbound system events
- Added `UserContextProvider` for wallet/user state (replaces local state)
- Wallet state changes auto-synced via `onUserStateChange` subscription
- Handler hooks: `useWalletHandler()`, `useNotificationHandler()`

### API Simplification

- Removed `publicKey` prop from `AomiRuntimeProvider`
- Removed `WalletSystemMessageEmitter` component
- Removed `AomiRuntimeProviderWithNotifications` (use `AomiRuntimeProvider`)
- User address obtained from `useUser().user.address` internally

### Backend Compatibility (merged from codex branch)

- Added `tool_stream` field to `AomiMessage`
- Added `rehydrated`, `state_source` fields to `ApiStateResponse`
- System events use tagged enum format: `{ InlineCall: { type, payload } }`

### Apps Updated

- `apps/registry/src/components/aomi-frame.tsx` - uses new API
- `apps/registry/src/components/aomi-frame-collapsible.tsx` - uses new API
- `apps/registry/src/components/control-bar/` - uses thread-scoped control state

## Provider Structure

```
AomiRuntimeProvider
└── ThreadContextProvider
    └── NotificationContextProvider
        └── UserContextProvider
            └── ControlContextProvider (receives getThreadMetadata, updateThreadMetadata)
                └── EventContextProvider
                    └── AomiRuntimeCore (syncs isRunning → threadMetadata.control.isProcessing)
                        └── AssistantRuntimeProvider
```

## Data Flow

### Thread Control State Flow

```
User selects model/namespace
        ↓
ModelSelect/NamespaceSelect onClick
        ↓
onModelSelect(model) / onNamespaceSelect(namespace)
        ↓
updateThreadMetadata(threadId, { control: { ...control, model/namespace, controlDirty: true } })
        ↓
(for model) aomiClient.setModel(sessionId, model, namespace)
        ↓
Backend stores model selection for session
```

### isProcessing Flow

```
Backend responds / assistant generating
        ↓
orchestrator detects isRunning change
        ↓
core.tsx useEffect syncs to threadMetadata.control.isProcessing
        ↓
ControlContextProvider reads from getThreadMetadata(sessionId).control.isProcessing
        ↓
ModelSelect/NamespaceSelect get isProcessing from useControl()
        ↓
Controls disabled while isProcessing === true
```

## Pending

- /build admin visibility page: an admin-only surface into the sandbox +
  whole build system — live/settled runs across all users (from the
  aomi-build-smither store + build_sessions), per-run sandbox id/status/
  extend history, stage timeline + validate-loop iterations, agent billing
  path + model + token spend per run, quota consumption per user, and
  cancel/stop controls. (Cecilia, 2026-07-19; gates the staging soak.)
- /build SDK-sync GitHub Action: build golden images tagged
  build-runner:sdk-<version> on aomi-sdk release (repository_dispatch →
  workflow in this repo), push to VCR, wait Ready, dispatch one canary
  run-plan and require green before the tag goes active; build-staging /
  build.aomi.dev resolve the image from their backend's SDK version, env
  pin as override. (Approach approved 2026-07-19.)
- /build quota + allowlist tables in aomi-build-smither DB: build_sessions
  (github_login, app slug, run id, status) capped at 5 active per user;
  invite allowlist table + env bootstrap; global concurrent-sandbox cap.
  Build tokens stay OUT of the cost dashboard (experimental feature).
- /build OpenRouter billing: verify one cloud sandbox run billed via
  SMITHER_OPENROUTER_API_KEY (kimi-k2.7-code) before staging; rotate the
  chat-pasted OpenRouter key first.
- Aomi Build SDK-upgrade UX rebuilt (2026-07-16, PR aomi-labs/aomi#366): `use-sdk-upgrade` hook (confirm → open PR → poll-for-merge via the idempotent sdk-upgrade endpoint → merged → redeploy), `upgrade-rail.tsx` (5-step stepper with PLATFORM/YOU/YOU/GITHUB owners, hover hints on every step, build checklist driven by deployFlow), `deployment-detail.tsx` (per-row expansion: source repo / commit / SDK / deployed platform / platform branch / apps / build artifacts — all GitHub-linked; platform-side fields lazy-load from `deploymentHistory`), `hint-bubble.tsx`; `deployments-tab.tsx` wires the CTA swap (Upgrade → Review PR #N), redeploy gating while the PR is open, and the upgrade confirm dialog with don't-ask-again; rail state persists in localStorage per source. 218 tests + typecheck + lint green. Backend path verified against staging (sdk-upgrade for 1586 now returns `current`). Not yet verified against a live signed-in browser session — needs a preview deploy.
- SDK upgrade 502 masking: FIXED. `SourceRepo::repo_route("")` trailing-slash 404 fixed in product-mono#815 (merged, staging-deployed); the remaining manager 502→500 conversions (OAuth exchange, GitHubAppError::Upstream, ActivationError gateway variants) are in product-mono#826 (open). Cloudflare replaces origin-502 bodies with branded HTML, so handler errors must never use 502/503.
- Follow-up work spun off (background sessions 2026-07-16): lightweight manager PR-state endpoint to replace the 45s tarball-download merge poll; investigation of stale `app_source` installation bindings (duplicate 141779906/142228159 branches for playground-6).
- /build engine mode: render approvals/clarifies in the UI (decision route
  exists; runs default to autoApprove until then)
- Vercel prod shape for the engine: SMITHER_DATABASE_URL (shared Postgres) +
  @smithers-orchestrator/vercel sandbox provider for compute phases (v2)
- End-to-end testing of wallet tx request flow
- SSE event handling verification (SystemNotice, AsyncCallback)
- E2E verification of control flow: apiKey → namespaces → model selection
- Thread list should show model/namespace per thread (optional enhancement)

## Demo-video credibility boundary documented (2026-08-01)

- Finding (grep-verified): the recording wallet has NO Para code — E2E executor
  is viem/@solana/web3.js/tweetnacl + HMAC cookie; the 8 `@getpara/*` packages
  and `providers/para/` plugin are off the recording path. The identity object
  hardcodes `walletProvider: "para"`, so takes display a Para badge for a
  non-Para wallet — must be relabeled (`walletProvider: "e2e"`, 1 line in
  e2e-wallet-provider.tsx) or real Para wired, before any partner-facing cut.
  NOT changed yet: Cecilia's call, since the chip loses its brand either way.
- Documented in `demo/README.md` → "What a take proves — and what it does not"
  (real vs double, the Para badge, why no popup appears, caption guidance:
  say "pre-authorized agent wallet", never "no approval needed"), with a
  pointer section in `specs/DEMO-STUDIO.md`.
- Signing model recorded for the recurring question: demo wallet is
  `client_auto` (not `auto`/delegated); it earned that via the bind +
  client_auto permit ceremony off camera. Browser holds only the HMAC session
  cookie; the key is a server-only env var behind `import "server-only"`, so it
  cannot reach the client bundle. In production `client_auto` the edge signer
  is often genuinely the browser (Para MPC/passkey) — the studio moves it
  server-side so no key material is near a recording.

## Reconciled with product-mono fix/svm-read-cluster-default (2026-08-01)

- Cecilia's BE branch (not yet CI-green) is THE build the Solana studio work
  must run against: `git checkout fix/svm-read-cluster-default` in
  product-mono before building backend/CLI for takes. It contains:
  (a) ATA_CREATE_IDEMPOTENT in the svm skill manifests (marinade/kamino/
  drift) — supersedes the task chip I filed (dismissed); ds6's empty-mSOL-ATA
  fixture kept as belt-and-suspenders. (b) SVM read cluster-default fixes,
  wallet-less reads, declarative SPL transfers via curated registry.
  (c) policy/svm.rs commit-matrix refactor.
- Contract check against the branch: authorization.rs UNCHANGED (ceremony
  script contract holds); staged wallet envelope still `status:
  pending_approval` + `chain_kind: svm` + `svm_ix_ids` (interpreter matcher
  holds); `pending_solana_id` is NOT in the staged tool envelope — it only
  exists between wallet request and callback (policy/svm.rs wallet_pending).
- RESOLVED the flagged phase-4 unknown accordingly: outcomes now ALSO keyed
  by `unsigned_tx` (present on BOTH the envelope and every solana completion
  callback) — `TxOutcomes.svmByTx`, enrichment falls back to it when a result
  has no pending id. react tests 140/140.

## Solana phases 2-4 IMPLEMENTED, unverified live (2026-08-01, forked session)

- Implementation only per Cecilia (no heavy runs / OOM): all code in place,
  vitest+tsc+eslint green, NO live recording yet.
- Phase 2 (studio): `demo/capture/svm-env.ts` (assertSurfnetOrDie via
  getVersion "surfnet-version"; resetSvm; surfnet_setTokenAccount seeding;
  sol/spl balance readers; checkAssertions). `types.ts` gains `svm{cluster,
  tokenAccounts, verify}`. `record.ts`: EVM lifecycle gated on
  chains.length>0, seed URL carries svmAddress+svmCluster
  (AOMI_E2E_SVM_ADDRESS), per-VM execution proof — EVM block-delta vs SVM
  balance assertions with 30s settle polling.
- Phase 3: `demo/capture/authorize-svm.mts` — zero-dep bind+client_auto
  ceremony (node:crypto Ed25519, PKCS8-wrapped seed; pubkey passed as arg to
  avoid base58 dep). Not yet run.
- Phase 4: collectTxOutcomes returns per-VM maps {evm, svm} (id spaces
  collide numerically!); accepts wallet::solana_{sign,send,sign_and_send}_
  complete with signed/submitted→success, rejected/failed→failed (sign_message
  ignored); enrichment keys on pending_solana_id. `txOutcomeStatus` hoisted to
  interpreter normalize.ts, used by evm-tx AND svm-tx pending_approval.
  Tests: react 139, e2e-wallet 10, interpreter 38 — all passing.
- New scenario `ds6-sol-swap-stake` (chains:[], svm mainnet-beta, empty mSOL
  ATA fixture, balance assertions from spike rates, two-turn).
- UNVERIFIED (needs a live run, deliberately deferred): ceremony script
  against real portal+backend; SVM challenge/commit field names
  (message_base64/permit) assumed from backend source; recorder svm path end
  to end; whether svm staged tool results actually carry pending_solana_id
  for enrichment (spike tail didn't show the tool-result shape — if absent,
  enrichment needs the runtime to thread it).

## Solana phase 0+1: DONE (2026-08-01, forked session)

- BOTH scenario-6 legs EXECUTE on the Surfpool mainnet-fork mirror, verified
  from chain state (see SOLANA-DEMO-PLAN.md "Phase 0 VERDICT"): Jupiter
  0.5 SOL→35.96 USDC finalized; Marinade 2 SOL→1.4313 mSOL confirmed. The
  plan's riskiest unknown (Jupiter quote replay) is resolved YES — Surfpool
  even substitutes a safe blockhash (SURFNETxSAFEHASH…).
- Phase 1 shipped in this worktree: `solana:mainnet` added to E2ESvmCluster
  (e2e-wallet.ts + provider type), normalize accepts mainnet/mainnet-beta;
  safe because the SVM executor is loopback-RPC-only regardless of cluster.
  e2e-wallet tests 10/10.
- Mirror recipe: `[surfpool.mainnet-beta]` section appended to the operator
  providers.toml (airdrop HtVw…2LsA 10 SOL + 25 USDC fixture); demo keypair at
  ~/.aomi/test-env/svm/demo-mainnet-fork.json (fork-only). Mirror left RUNNING
  on 127.0.0.1:8899 (pid in ~/.aomi/test-env/svm/; `test-env svm down` stops).
- Fork-authenticity probe for the studio: getVersion → "surfnet-version".
- Product gaps found: (a) marinade/svm_stage_ix skills can't create ATAs
  (chip filed — needs skill owner); demo workaround = surfnet_setTokenAccount
  empty-ATA fixture. (b) CLI-under-FULL_TESTNETS needs
  AOMI_ALLOW_HOSTED_TEST_DB=1 for skill IDL lookups (guard working as
  designed; backend path unaffected).
- Remaining for a recorded Solana take: phase 2 (recorder svm scenario block,
  reset+fixtures, balance-assert verify replacing block-delta) and phase 3
  (SVM bind + client_auto ceremonies, then record). Phase 4 = svm-tx trace
  outcome parity.

## Solana demo plan (2026-07-31 late, forked session)

- `specs/SOLANA-DEMO-PLAN.md` written — replication plan for scenario 6 on the
  Surfpool SVM mirror. Grounded in source: `test-env svm` forks MAINNET-BETA
  (`svm/state.rs:316`) and seeds USDC declaratively via `surfnet_setTokenAccount`
  token fixtures (`svm/fixtures.rs`) — richer than the EVM harness.
- Only code gap in portal: `E2ESvmCluster` lacks `"solana:mainnet"`; safe to add
  because the SVM executor already refuses ANY non-loopback RPC (stricter than
  the EVM anvil probe). Only real unknown: Jupiter quote replay against fork
  state (ALTs + drift) — phase-0 CLI spike answers it before any code.
- Recorder design change for SVM: Surfpool mints slots on a clock, so block
  advance proves NOTHING — plan replaces it with declarative balance assertions
  (SOL down / USDC up / mSOL up), worth backporting to EVM.
- SVM trace-outcome parity (svm-tx family + collectTxOutcomes accepting solana
  callback types) planned as phase 4; verify callback event names first.
- Coordination: the EVM rig is being extended concurrently (erc20 seeding
  landed in types.ts/test-env.ts from the other session) — svm scenario-shape
  changes must rebase on that.

## Trace truthfulness + system-echo cleanup (2026-07-31, forked session, merged into this worktree)

- Two UI fixes ported/built here (the forked nervous-haibt worktree was deleted
  after porting, per Cecilia):
  1. HIDE SYSTEM ECHO: `packages/react/src/runtime/utils.ts` drops
     `sender=system` messages prefixed `Response of system endpoint:` from the
     thread (backend `thread.rs` transcribes every /api/system callback
     verbatim FOR THE MODEL; the CLI has filtered it since day one in
     `cli/commands/history.ts`; the web UI rendered raw JSON as an assistant
     bubble). Prefix guard runs BEFORE isCreditNotice so a tx callback
     containing "payment" can't become a Credits card.
  2. ASYNC OUTCOME RECONCILIATION: staged tx steps froze at "Queued ✓" even
     when the later `wallet:tx_complete` said failed. Now
     `collectTxOutcomes()` (utils.ts) mines the (hidden) echo messages for
     `pending_tx_ids` outcomes — latest wins; computed over the FULL raw list
     in `projectInboundMessages` (orchestrator.ts) so truncated projections
     still reconcile; survives reload since the transcript is the durable
     record. `toInboundMessage` attaches `tx_outcome` to matching tool
     results; `matchStagedTx` (tool-interpreter families/evm-tx.ts) prefers
     `tx_outcome.status` over `current_lifecycle` for the status fact — chips
     flip Queued → Success/Failed and `isFailedStatus` drives the red-X step
     marker for free.
- Callback shape verified from `packages/client/src/session/wallet.ts`:
  `{txHash, status: "success"|"failed", error?, pending_tx_ids: number[]}`.
- Tests: packages/react 136/136 (5 new), shadcn-registry 281/281 (2 new
  interpreter tests; package-boundary tests need `pnpm run build:package`
  first — dist/ missing is an environment condition, not a regression).
  eslint + tsc clean.
- Root-cause note from the parallel session (memory): the simulate empty-body
  + ERR_ALPN bug = `new Request(url, req)` streaming-body footgun; fixed
  separately.

## Demo studio — scenario round 2 (2026-08-01)

- Scenario set rewritten per Cecilia: no easy swaps; lending, staking, bridging,
  pushed past vanilla. `demo/scenarios/`: ds2-stake-eth (proven),
  money-legos-stake-collateralize, aave-borrow-against-usdc, stake-shootout,
  ds4-bridge-to-base. Swap + plain-Aave-supply scenarios deleted as too easy.
- CATALOG REALITY CHECK: 5 of the 6 original DEMO-SCENARIOS.md entries are NOT
  fork-recordable, all for one reason — anything depending on an OFF-CHAIN
  service cannot be forked. Polymarket (live matching engine), 0x gasless
  (relayer submits to real mainnet), CEX (fills at the venue + no API keys),
  bridges via Across/LI.FI (filler relayers watch real chains), Solana
  (unverified mirror). Only pure on-chain contract calls work.
- `Scenario.erc20[]` added: seeds tokens by impersonating a holder (faucet
  Alice holds 10k USDC) since anvil_setBalance is native-only. Recorder also
  fixed to pass POST-reset chains to runScenario (ports can change on reset).
- NO COMPLETED VIDEOS THIS ROUND. Two product bugs blocked execution, both
  spawned as task_90d7e590:
  1. Multi-skill guard interference — with lido+rocket_pool+etherfi active,
     each guard rejects the others' txs at simulation. Kills the single most
     common staking prompt ("stake in the highest yield pool"), which is
     exactly what DS2 asks. Agent's workaround: "reset skills and stake in X".
  2. Staged txs lost between turns after a failed commit — a 6-tx batch that
     simulated clean had to be fully rebuilt.
- money-legos got FURTHEST and is the strongest product evidence so far even
  unfinished: agent discovered wstETH UNPROMPTED (Aave v3 won't take rebasing
  stETH), computed exact wrap output (~4.03 wstETH) to avoid rounding failure,
  staged and simulated all SIX transactions (stake → approve → wrap → approve →
  supply → borrow), and self-verified the Aave V3 Pool address against a Lido
  guard warning. Frame saved. Needed a 3rd turn to commit; even then hit bug 2.
- OPS FINDING (runbook-critical): the backend caches the fork endpoint AT BOOT.
  Restarting `test-env evm up` gives a NEW random port, so the backend MUST be
  restarted after every fork restart or it silently talks to a dead proxy
  ("connection issue with the network provider").
- ENVIRONMENT: memory is the real constraint — free RAM hit 154 MB with Cursor
  + tsserver + rust-analyzer + next-server + another session's cargo build. The
  test-env proxy is what gets OOM-killed, which is the recurring "fork died"
  mystery from the whole session. Recording needs fork + backend + portal +
  chromium concurrently; close heavy apps first.
- Also: earlier "15 anvils" panic was a misread — those were clang processes
  compiling the aomi-anvil crate, not anvil instances.

## Demo studio — FIRST SUCCESSFUL RECORDING (2026-07-31 late)

- `demo/out/ds2-stake-eth/ds2-stake-eth-master.mp4` (27.6s) + markers.json:
  two-turn DS2, Lido stake EXECUTED on the fork. Verified on-chain: account 2
  (0x3C44...93BC) holds 5.0 stETH, ETH 10 → 4.9999, block 25655803 → 25655804.
- The last-mile fixes, in order:
  1. Backend trust: portal signs bearers with kid `aomi-bff-dev-1` but local
     service.toml only trusted `aomi-bff-staging-1` (same keypair!) — added a
     dev-kid trust record to the demo worktree's gitignored service.toml.
  2. Wallet identity: anvil account 0 is BOUND to another user (the old anon
     E2E artifact) — switched demo signer to unbound anvil account 2, then ran
     the bind + client_auto permit ceremonies via curl + `cast wallet sign`
     (challenge → EIP-712 sign → commit; mode strings: bind, client_auto).
     NOTE: this bound anvil dev account 2 (public key!) to Cecilia's account in
     the prod DB — revoke when demos are done (mode=denied or unlink).
  3. Client flag: the E2E provider checks NEXT_PUBLIC_AOMI_E2E_EXECUTION_MODE
     (not the server-side var) AND Turbopack caches inlined env across restarts
     — cleared `.next-demo-studio` to pick it up.
  4. FE BUG (spawned task): browser POST /api/exec/simulate sends an EMPTY
     body (+ intermittent ERR_ALPN_NEGOTIATION_FAILED) → fee simulate 400s →
     wallet request rejected. Studio stubs the route with a no-fee success
     (WORKAROUND in record.ts); backend-side simulate_batch still real.
  5. E2E executor policy was self-transfer-only — added an additive
     fork-verified branch to apps/portal/src/server/e2e-wallet.ts: contract
     calls allowed ONLY when the RPC answers `anvil_nodeInfo` (fails closed);
     real-RPC posture unchanged. executionKind "e2e_real_fork_call" added.
     Value cap raised via AOMI_E2E_MAX_NATIVE_WEI=6e18 in .env.local.
  6. Multi-turn scenarios (`prompts: string[]`), typed-text verification
     (hydration ate the first keystroke), consent-banner dismissal per turn,
     funding AFTER `test-env evm reset` (reset reforks and wipes balances),
     block-advance polling (30s) instead of instant sampling.
- Honest caveats: video tail cuts mid-sentence of the post-execution
  confirmation (recorder should settle-wait for a follow-up turn); sidebar
  shows debug threads — takes DO create real threads on Cecilia's prod account
  now that auth works (earlier "no writes" check predated working auth);
  archive them before a partner-facing take.

## Demo studio — landed so far (2026-07-31)

- `apps/portal/src/components/providers/wallet-providers.tsx` now consumes
  `useFullTestnet` + `FullTestnetWalletRouter`. Routed chains go to BOTH the
  E2E-wallet branch and the normal wallet-kit branch (demos need E2E wallet AND
  fork RPC together). Inert unless `NEXT_PUBLIC_USE_FULL_TESTNET=true` and the
  RPC map parses. Portal type-check + eslint clean, 329/329 portal tests pass.
  NOTE: `apps/landing` only uses `isFullTestnet()` as a guard and never routes
  chains — it is still not fully wired. Left alone (not our change to make).
- New `demo/` dir: `capture/test-env.ts` (fork orchestration, Playwright-free),
  `capture/selectors.ts`, `capture/record.ts`, `scenarios/types.ts`,
  `scenarios/ds2-stake-eth.scenario.ts`, `README.md`. Non-Playwright files
  typecheck clean; `eslint demo` clean; root `typecheck` is scoped to
  `packages/react/src` so `demo/` cannot break it.
- Selectors use EXISTING aria-labels (`Message input`, `Send message`,
  `Stop generating`) + `data-role="assistant"` — no `data-testid` added to
  production code. `Stop generating` presence/absence is the streaming signal,
  so the recorder never sleeps.
- SAFETY: full-testnet routing FAILS OPEN to real mainnet if env is missing —
  scenarios that stake/swap would spend real money and the take would still look
  successful. Two guards, neither to be downgraded: `assertForkedOrDie()`
  (`anvil_nodeInfo` probe) and `watchForForkTraffic()` (fails the take if the
  browser never hit the fork port).
- `@playwright/test` + `tsx` added as root devDependencies (approved
  2026-07-31); chromium downloaded. All demo files typecheck + lint clean.
  `demo/out/` gitignored — recorded masters are regenerable artifacts.
- CLI CORRECTIONS found by reading `product-mono/aomi/bin/cli/src/cli.rs`
  (both contradict `full-testnet.md`, which is wrong on the first point):
  1. The real command has an `evm`/`svm` layer: `aomi test-env evm up --chains 1`,
     `... evm reset --chain 1`. NOT `aomi test-env up`.
  2. The released CLI on PATH (homebrew v0.3.9) has NO `test-env` group at all
     ("Unknown command test-env"). Must build from product-mono source;
     `demo/capture/test-env.ts` defaults `AOMI_BIN` to that debug build.
- SOLANA CORRECTION: `aomi test-env svm` EXISTS — a Surfpool-backed local SVM
  mirror (up/down/status/reset + wallet/airdrop/usdc). My earlier "Solana has no
  usable fork, settled" was wrong; it was based on the byreal doc, which is only
  right about byreal (off-chain orderbook, unforkable). Jupiter/Marinade are
  on-chain and may work against the mirror — UNVERIFIED, but try it before
  accepting real-money Solana takes.
- VERIFIED against a live fork (2026-07-31). `aomi-cli test-env evm up --chains 1`
  needs `PROVIDERS_TOML=~/Code/product-mono/providers.toml` (it is NOT found from
  this repo's cwd). Fork came up on chain 1, faucets Alice/Bob funded 100 ETH +
  10k USDC each. `pids.json` real schema confirmed:
  `{version, started_at, proxies:[{chain_id,pid,port,endpoint,fork_url,name}]}`
  — `parsePids()` rewritten to match and prefers `endpoint` over rebuilding it.
  `assertForkedOrDie()` passes on the fork AND a negative control proves it
  REJECTS a real mainnet RPC (cloudflare-eth.com), so the spend-real-money path
  is genuinely guarded.
- BLOCKED on first recording. Four walls hit in order, each real:
  1. Hosted backend can't work: agent tools run SERVER-side, so a staging
     backend reads real mainnet and never sees the fork. Backend MUST be local.
  2. Anonymous E2E session 402s (no payment rail). FIXED by
     `E2E_STUB_CANONICAL_USER_ID=8641fa7c-c03c-47b4-89af-0230bad8cbf6`
     (cecilia@foameo.ai, 266/500 credits used) — maps the E2E session onto a
     real account. NOTE: comping credits would NOT have fixed this; the anon
     account had zero usage against a 500 cap. Verified read-only, no DB writes.
  3. GitHub 429 rate limiting on app tarballs. FIXED by
     `OFFICIAL_GITHUB_TOKEN="$(gh auth token)"`.
  4. Catalog hydration: FIXED via new `LOCAL_SCOPED_APPS` env var (see below).
  5. Schema drift (RESOLVED same evening): the #904 migration
     (`active_deployment_record_id` + `deployment_records`) was applied to the
     hosted DB out-of-band later that night — column verified present, so
     current main boots fine now. NOTE: the migration is NOT in
     `supabase_migrations.schema_migrations` (ledger ends at 20260726030000);
     file is idempotent so re-application is a no-op, but the ledger should be
     reconciled. The throwaway pre-#904 worktree
     `~/Code/product-mono/.claude/worktrees/demo-rig-backend` is now
     unnecessary (~7GB; `git worktree remove --force` reclaims it). Future
     demo backends: build from current main.
  6. Demo stack torn down 2026-07-31 ~23:00 (memory pressure): backend killed,
     `test-env evm down` clean, all anvils gone. Restore = fork up → read
     port from pids.json → regen portal .env.local ports → relaunch backend
     with LOCAL_SCOPED_APPS (see demo/README.md).

## LOCAL_SCOPED_APPS backend scoping (2026-07-31, uncommitted in product-mono main)

- `aomi/bin/backend/src/handler/app/reconcile.rs`: `local_scope:
  Arc<Option<HashSet<String>>>` on `ArtifactsReconciler`, parsed from
  `LOCAL_SCOPED_APPS` (comma-separated app names, lowercase-normalized; Cecilia
  requested plain Option<HashSet> over a wrapper struct). When set: (a) rows
  not in the set are skipped in `reconcile_active_once` — applies to both
  poll and `wake`; (b) `reconcile_official_catalog_rows` is SKIPPED entirely,
  because it UPSERTS rows into the shared `applications` table and a scoped
  dev/demo host must not write the shared catalog (my local backend had been
  doing exactly that against prod on every poll).
- Composes with the other session's committed `FetchBreaker` (e7b6f7536):
  breaker = steady-state hygiene for dead tags, scope = hard boundary for
  non-fleet hosts. 8/8 reconcile tests pass, fmt clean.
- No way to say "no apps at all": scope activates only when non-empty, so the
  demo uses sentinel `LOCAL_SCOPED_APPS=demo-studio-none` (matches nothing).
  Skills-only scenarios (DS2) need exactly this.
- Fork proxies do NOT reliably survive other sessions: state at
  `~/.aomi/test-env` was wiped mid-session (likely the other Claude's test
  run). Port changes on every re-up (51610 → 55465 → 49330) — always re-read
  `pids.json` and regenerate portal `.env.local`.
- GUARD CORRECTED: `watchForForkTraffic` was mis-specified (browser never
  contacts the fork by design) and would have failed every take. Replaced with
  `forkProgress()` — block height before/after, enforced only when a scenario
  sets `expectsExecution`. `assertForkedOrDie()` unchanged and still correct.
- Selector bug fixed: working-trace renders "Working" / "Worked for 5.6s" /
  "Worked it out"; matching only the last burned the full 180s timeout per take.
- A fork proxy is LEFT RUNNING (chain 1, pid 76737, port 51610). Stop with
  `FULL_TESTNETS=true ~/Code/product-mono/aomi/target/debug/aomi-cli test-env evm down`.

## Demo studio (2026-07-30, in progress)

- Goal: systematic, repeatable product demo videos for BD calls + social + docs.
  Design agreed; nothing implemented yet. See `specs/DEMO-STUDIO.md`.
- Architecture: 3 layers — scenarios (content) → fork fixture (determinism) →
  Playwright capture (automation). Record ONE master per scenario + timestamped
  markers; derive short cuts, never re-shoot per format.
- **Layer 2 already exists — do not build it.** `aomi test-env up/down/status/
  reset` in product-mono spawns detached pre-funded anvil-fork proxies per chain
  (gated on `FULL_TESTNETS=true`, needs `ALCHEMY_API_KEY`). Frontend routing
  (`NEXT_PUBLIC_USE_FULL_TESTNET`, `FullTestnetWalletRouter`) preserves REAL
  chain ids while swapping RPC, so the UI shows "Ethereum · Mainnet" on camera
  while running on a fork. Remaining Layer 2 work: fork block heights, non-USDC
  whale funding, wiring the capture runner to test-env.
- Capability boundary: SDK plugins verified against `~/Code/aomi-sdk/apps/*/src/
  *.rs` — perps + lending (Hyperliquid, dYdX, GMX, Morpho, Yearn) READ-ONLY.
  But a SEPARATE protocol-skill layer (Uniswap, Lido, Rocket Pool, Ether.fi,
  Aave, CCTP, Stargate, Base native, Pendle) does execute — so liquid staking
  IS demoable. byreal perps write capability is UNVERIFIED (source not in this
  checkout); verify before scripting any perps scenario.
- Derive scenarios from the existing passing story catalog in product-mono
  (`docs/topics/testing-automation/facts/aomi-transact-automation.md`, ids
  DS1-6/P1-8/APP1-4) rather than inventing prompts — those paths are proven.
- On-camera gotchas: `aomi tx sign` prints the FEE tx hash (to 0x9C7a...519f5),
  not the protocol tx hash — never show it as the swap; route leakage
  (Uniswap → LI.FI/Sushi) can put the wrong protocol on screen; a dead local
  `providers.toml` makes healthy runs look flaky.
- Solana has NO usable fork (no meaningful byreal devnet) → mainnet, tiny
  amounts, treated as one-take proof video.
- `specs/DEMO-SCENARIOS.md` holds 6 draft scenarios awaiting external trader
  review. Blocking: do not build capture until the catalog is signed off.
- Pending: Solana fixture strategy; CEX sandbox credentials; which scenarios get
  real-mainnet proof videos with visible tx hashes; where finished videos land
  in the GTM system at scrum.aomi.dev.

## Notes

- `WalletFooterProps` still works - `wallet`/`setWallet` map to `user`/`setUser`
- `WalletButtonState` type alias kept for backwards compatibility
- Specs are designed for new agents to quickly understand the codebase
- `useControl()` hook provides access to control state and actions
- Control bar components get all data from context (no props needed)
- New threads initialize with `createDefaultControlState()` (null model/namespace)
- Thread switching restores the thread's previous model/namespace selection
