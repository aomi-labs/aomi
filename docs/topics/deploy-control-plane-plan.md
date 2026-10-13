# Deploy control plane — design and migration plan

Status: Phases 0–2 IMPLEMENTED in working trees (2026-07-10, unreviewed,
uncommitted). Phase 3–4 blocked — see "Execution status" at the bottom.
Scope: `apps/build`, `packages/deploy`, `aomi/bin/backend`, edge worker config.
Origin: 2026-07-10 design session; grounded against the code paths cited inline.

## 1. Problem

Four defects, one root cause:

1. **FE talks to GitHub directly** in two places
   (`apps/build/src/server/bff/launch/routes.ts` — `enrichPendingCiStatus`
   ~L459 and the redeploy rerun call ~L1178; duplicated in
   `packages/deploy/src/bff/launch-routes.ts` L219/L676, which is the published
   partner SDK, not dead code). Unauthenticated = 60 req/hr per Vercel egress
   IP → the wizard poller hangs; with `GITHUB_TOKEN` = a second GitHub
   credential living outside the BE, and every partner needs their own.
2. **Hot polls fan out to GitHub.** Every status poll costs the BE 3–5 GitHub
   calls (`resolve_deploy_ci` → `ci_outcome` + `check_app_release` per app),
   plus the FE enrich re-reads GitHub on top ("double GitHub"). GitHub quota
   is per App installation and shared across all tokens — distributing tokens
   does not distribute quota. Dashboard-scale polling (N users × M repos ÷ 5s)
   exceeds 5,000/hr structurally; only aggregation fixes it.
3. **Two sources of truth for deployment state.** System of record is Git
   manifests in the platform repo; the DB copy lags (see "Tolerate stale
   deployment records", PR #303). Card hydration, history, and status all pay
   GitHub round-trips per page view because reads go to the manifests.
4. **The runtime binary carries build-infrastructure concerns.** GitHub App
   key, webhook-less CI discovery, and private release-asset fetching
   (`bin/backend/src/handler/app/reconcile.rs` imports `GitHubApp` +
   `SourceRepo`) all live in the same process that runs apps and serves chat.

Root cause: the invariant "GitHub is our build infrastructure and only the BE
holds credentials for it" was never broken *conceptually* — it leaked
implementationally in the four places above.

## 2. Target architecture (decided)

Layering (see session diagrams):

- **Our FE page (`apps/build`)** — shell only: routing, branding,
  session UI. Structurally "the first partner" of the package.
- **Package (`@aomi-labs/deploy`)** — the deployment feature, GitHub-free.
  Ships the BFF route factory (each consumer mounts their own BFF in their
  TanStack Start or other server), typed client, hooks/UI. Partner config surface:
  `platform`, backend base URL, session/auth adapter, Aomi-issued service
  credential. **Not** configurable: any GitHub token (option gets deleted).
- **Build control plane (new Rust bin)** — everything that bridges to
  GitHub: deploy writes (commit/PR/manifest), webhook ingress, DB
  projections, rerun, reconciler, artifact push, App credentials
  (`github_app.*.toml` moves here). Decision: **Rust bin, not a Cloudflare
  Worker** — domain logic already exists tested in Rust; shared
  `aomi-database` schema is a compiler-enforced contract; Postgres locality.
  The existing edge worker only gains a path route.
- **Runtime backend (`bin/backend`)** — loads and runs apps, chat, accounts.
  End state: zero GitHub code, no App key, no webhook secret.
- **Shared contracts (the only coupling between the two bins):**
  - Postgres: control plane writes desired state + projections; runtime
    reconciles toward it (this pattern already exists in-process —
    `handler/app/reconcile.rs` converges AppStore from DB rows) and writes
    back actuals (`loaded`).
  - Artifact store (R2 via S3 API): control plane pushes release assets at
    activation (content-addressed; `release_asset_digests` already exist);
    runtime pulls over HTTPS. Kills the private-release-asset auth failure
    class. No Worker code — R2 is just a bucket.

Data-flow rules:

- **Write path:** BE writes GitHub (commit · PR · manifest) and
  write-through-projects the same record into Postgres. It never reads back
  what it wrote.
- **Freshness:** GitHub pushes (`workflow_run`, `push` webhooks) → projection.
  Reconciler does one `ci_outcome`-style read (by `head_sha`, App token) only
  when a deployment's state has been quiet past a threshold. GitHub calls
  scale with builds, not viewers.
- **Read path:** every dashboard row (ours and partners') is served from
  Cookie / Runtime / DB / Prometheus / Vault. Zero GitHub on any read path.
  Optional SSE stream replaces FE polling.
- **Escape hatch (later, if ever):** BE-minted short-lived repo-scoped
  read-only installation tokens for partner *servers* needing raw GitHub
  data. Never to browsers; never write scopes.

Config split (decided, status quo kept):

- `github_app.*.toml` + env placeholders = *our* GitHub App identities.
  Static, reviewed, rare. Never accepts partner keys.
- `platforms` DB rows = tenant data (repo, branch, status). Settable via
  provisioning. Add later: explicit App-slug column per platform to make
  credential resolution deterministic. If a per-platform PAT fallback is ever
  needed, it is an encrypted column on the platform row — not toml, not env.

## 3. Phases

Each phase is independently shippable; none is thrown away by later phases.

### Phase 0 — stopgap (in working tree now, unmerged)

- `fix/deploy-flow-usability` diff: `commitMatches` prefix-tolerant run
  matching in `enrichPendingCiStatus`, activation error surfacing, sign-out
  wizard-state reset, refresh latch fix, `settleBySource` on operate routes.
  Verified: 32/32 launch tests, typecheck, lint clean (5 suite failures
  pre-exist at HEAD in deploy-step/project-row component tests).
- Optional: `GITHUB_TOKEN` (fine-grained PAT, `community-apps` only,
  Actions read/write) in Vercel **only if** Redeploy must work before
  Phase 1. Skip if Phase 1 lands soon.
- Optional: port `commitMatches` to `packages/deploy/src/bff/launch-routes.ts`
  (still has the `?? runs[0]` stale-fail bug at L232/249) — or accept the
  known divergence since Phase 1 deletes the whole function.

### Phase 1 — restore the invariant (small, highest value)

Backend (`aomi/bin/backend`):
- `POST /platforms/{p}/deployments/{id}/rerun` — App installation token,
  ownership check copied from the status handler. Grant the App
  `Actions: read + write`.
- Plumb the workflow run `html_url` into `CiOutcome` (today `aggregate_ci`
  only returns the branch-query fallback URL) so the FE keeps its deep link.

FE/package:
- Delete `enrichPendingCiStatus` + `githubToken` option from **both**
  `apps/build/.../launch/routes.ts` and
  `packages/deploy/src/bff/launch-routes.ts`.
- Repoint the BFF redeploy route at the new BE endpoint.
- Remove `GITHUB_TOKEN` from Vercel env.

Also in this phase (auth hardening from the BFF review): partner-scoped
service credentials — a partner's BFF bearer must only act on its own
platform's sources, instead of the shared `role: "service"` mint
(`apps/build/src/server/bff/backend.ts`).

Exit: no GitHub credential exists outside the BE; partner package needs zero
GitHub config.

### Phase 2 — projection + webhooks (kills hot GitHub reads)

- Write-through projection at deploy time: deploy handler writes manifest to
  Git *and* the full record to `deployment_records` in one operation.
- Webhook ingress on the BE: `workflow_run` + `push`, HMAC-verified
  (secret already in `github_app.toml` shape). Updates CI state and re-syncs
  manifest-derived fields keyed by `head_sha`.
- Reconciler: if a live deployment hasn't progressed in N minutes, one
  `ci_outcome` read by commit. This is the surviving descendant of
  `enrichPendingCiStatus`, in the right layer.
- Status/history/card-hydration endpoints serve pure DB. Freshness contract:
  webhook-fresh (seconds) / reconciler-fresh (minutes); surface the
  projection timestamp in payloads.
- Optional: SSE status stream to replace FE polling.
- Delete the Phase 0 `commitMatches` stopgap (webhook payload carries exact
  `head_sha`; the matching problem stops existing).
- Reframes PR #303's "tolerate stale records" from posture to transition.

Exit: every row of the read-path inventory table is Cookie / Runtime / DB /
Prometheus / Vault. GitHub calls scale with builds only.

### Phase 3 — artifact store

- At activation, control-plane code pulls release assets once and pushes to
  R2 (S3 API from Rust), keyed by existing digests.
- `handler/app/reconcile.rs` pulls from R2; drop its `GitHubApp` /
  `SourceRepo` imports.

Exit: runtime load path has no GitHub dependency; private-asset auth
failures eliminated.

### Phase 4 — extract the control-plane bin

- Move to new bin (name TBD — suggest `bin/deployd`):
  `endpoint/platform/`, `endpoint/integration/github_app.rs`,
  `handler/platforms/*`, `auth/header/platform_activation.rs`,
  `github_app.*.toml` loading. Both bins keep sharing `aomi-database`
  (do **not** split the DB — the shared schema is the contract).
- **Move, not copy** — the launch-routes drift found this session is the
  cautionary tale.
- Edge worker: route `/api/platforms/*`, `/api/integrations/github/*` → new
  origin. Partners keep one base URL.
- Repoint GitHub App webhook URL to the control plane.
- Ops: second systemd unit behind the existing tunnel initially.

Exit: `bin/backend` contains zero GitHub code; the trust boundary from the
design is a process boundary.

Sequencing rationale: Phase 2 before Phase 4 — extracting first would carve
today's GitHub-live read paths across a service boundary, then redo them.

## 4. Rejected alternatives (with reasons)

- **`GITHUB_TOKEN` in Vercel as a permanent fix** — second credential/trust
  boundary; worse GitHub access path (rate limits) from the less privileged
  place; every partner inherits the requirement; rerun needs Actions *write*
  so the PAT is not read-only-cheap.
- **Tokens at the edge / per-browser tokens for CI sync** — quota is per
  installation and shared; distributing tokens does not distribute quota
  (100 dashboards × 3 repos / 5s ≈ 216k calls/hr vs 5,000).
- **Cloudflare Worker as the whole control plane** — bilingual domain logic
  forever (see the FNV "bit-identical to the edge worker" comment in
  reconcile.rs for the drift tax in miniature); rewrite of tested Rust state
  machines vs. moving them; Postgres locality inverts. Worker keeps front-door
  and (optionally, later) edge-cache roles only.
- **Per-platform env PATs (`BUILD_PLATFORM_GITHUB_TOKEN__<P>`)** — env sprawl
  for tenant data; belongs (if ever) as an encrypted platform-row column.
- **Accepting partner GitHub App keys into our toml** — that's the
  self-hosted-BE tier, a different product.
- **Splitting the Postgres DB along with the binary** — the shared,
  compiler-checked schema is the contract; splitting it recreates drift.

## 5. Execution status (2026-07-10 session)

**Phase 0 — done** (this worktree, uncommitted): the five-file usability diff,
verified (launch suite, typecheck, lint).

**Phase 1 — done, both halves, verified.**
- Backend (`product-mono` working tree, on `main`, uncommitted): rerun
  endpoint + `CiOutcome.run_id` + run `html_url` deep-link; route manifest
  test updated. 195/195 backend tests, fmt, clippy.
- TS (this worktree, uncommitted): `enrichPendingCiStatus` + `githubToken`
  deleted from **three** copies (aomi-build, portal — a third copy found
  during execution — and `packages/deploy`); redeploy routes repointed at the
  backend through new `DeploymentClient.rerunDeployment()`; OpenAPI fixture +
  generated route manifest regenerated (`AOMI_PRODUCT_MONO_ROOT=… pnpm run
  update:backend-openapi`). Workspace suite 630 passed; typecheck clean on
  package + both apps. NOTE: Phase 1 subsumes the Phase 0 `commitMatches` fix
  (function deleted); the remaining four Phase 0 fixes are intact.

**Phase 2 — done (redesigned per Cecilia to a proper `deployments`
projection), verified.** In `product-mono`:
- `supabase/migrations/20260710000000_deployments_projection.sql`: one
  `deployments` table — the manifest read model (full `DeploymentRecord` as
  JSONB + extracted/indexed columns) with webhook-fed `ci_*` columns
  (GitHub vocabulary: `ci_status` queued|in_progress|completed +
  `ci_conclusion`). Replaces the interim `github_ci_runs` design entirely.
- `DbDeployment` entity: `upsert_record` (never touches `ci_*`), `set_ci`,
  `apply_workflow_run` (matches on platform repo + branch, then commit
  prefix — short-SHA tolerant), `commit_matches` helper.
- Projection writers: write-through at deploy (`PlatformHandler::deploy`),
  lazy backfill on every status read (old deployments gain rows when first
  viewed), `workflow_run` webhook ingress (HMAC path reused).
- `resolve_deploy_ci` is projection-first with trust rules (completed CI
  always trusted; in-flight trusted 30 min via `ci_updated_at`; else one live
  read that writes CI back). Reconcile-on-read — no background task.
- Rerun flips the deployment's CI to `queued` by deployment id.
- Per-app GitHub release reads skipped while CI is in flight.
- Unit tests: trust rules, ci-column vocabulary, commit matching, webhook
  payload parsing. Backend 195/195, database suite green, fmt, clippy.
- Operational follow-ups: run the migration; subscribe the GitHub App to the
  `workflow_run` webhook event and grant `Actions: read + write`.
- Follow-up now unlocked by this table: switch latest-deployment / history /
  card-hydration endpoints to read `deployments.record` DB-first (lazy
  backfill populates rows organically; decide backfill posture before
  cutting reads over).

**Phase 3 — code done, verified; infra deliberately NOT provisioned.**
- New `crates/artifact-store` (`aomi-artifact-store`): S3-compatible client
  for Cloudflare R2 with hand-rolled SigV4 (no AWS SDK; signature pinned
  against an independent Python implementation), deterministic
  `releases/{repo}/{tag}/{target}.tar.gz` keys, sanitized segments.
  Config-gated via `AOMI_ARTIFACT_STORE_URL` / `_ACCESS_KEY_ID` /
  `_SECRET_ACCESS_KEY` (+ optional `_REGION`, default `auto`) — env absent →
  `from_env()` returns `None`, zero behavior change.
- Runtime `AppFetcher::fetch` is cache-through: store hit = zero GitHub
  calls; miss = existing GitHub download + best-effort backfill. Tarball
  integrity unchanged — `stage_bundle` verifies per-file sha256 regardless
  of byte origin.
- NO live Cloudflare changes made (per Cecilia). Blocker discovered: R2 is
  not enabled on the Aomi Cloudflare account at all (`code 10042`) —
  enabling it is a dashboard/billing step only she can do. After that:
  create bucket, mint S3 token, set the three env vars on the backend hosts.
- Proactive push-at-activation belongs to `bin/manager` in Phase 4;
  cache-through makes the fleet GitHub-free after the first fetch either way.

**Phase 4 — done (code), physical extraction, verified.** The deploy domain
now **lives in the `manager` crate** and the dependency arrow points the
right way: `backend` depends on `manager` (lib), never the reverse.
- Moved into `aomi/bin/manager/src/`: `platforms/*` (the whole
  HostedPlatform domain — handler, source_repo, github_app, deploy_records,
  platform_action, app_lifecycle, target_activation, + its 60 unit tests),
  `endpoints/*` (all deploy-surface HTTP handlers incl. the `workflow_run`
  webhook), `auth/*` (`PlatformActivationToken`, `Activation`,
  `AuthorizationHeaderExt`), and the `github_app.*.toml` App configs
  (deploy workflow paths updated to `aomi/bin/manager/…` — repo file only,
  no live change).
- Platform endpoints are typed on axum substates (`State<PlatformHandler>` /
  `State<DbPool>` with `FromRef<AomiBackend>` impls in the backend), so one
  set of handler fns mounts in both routers — zero duplication, no behavior
  change (route manifest tests unchanged; backend re-exports keep
  `crate::handler::platforms::*` paths alive for its remaining callers:
  the runtime reconciler and the runtime-coupled `apps` endpoints).
- `manager` (port env `MANAGER_PORT`, default 8081) serves: `/health`,
  platform list/server-tags, deploy, deployment status, rerun, records,
  sync-installed, tokens (mint/list/revoke), platform activate/deactivate,
  and the GitHub `workflow_run` webhook. Its `require_activation` layer is
  the same credentials-before-resources resolution as the backend's
  `RouteAuthClass::Activation` (token parse → `DbPlatform` lookup →
  `PlatformActivationToken::resolve` → `Activation` extension); the
  `Activation` extractor was made state-generic (it only reads the request
  extension).
- Runtime-coupled routes stay backend-only by design: app
  activation/promotion/live-app reads wake the in-process artifact
  reconciler. They move in a follow-up once the DB desired-state seam
  replaces the wake.
- Cutover (infra, NOT done — no live changes): deploy manager as a second
  systemd unit behind the existing tunnel; edge worker routes
  `/api/platforms/{deploy,deployments/*,tokens,sources,activate,deactivate}`
  and the GitHub App webhook URL to it; backend keeps serving everything
  until then, so the cutover is reversible per-route.
- Manager gains proactive artifact push at activation in the follow-up that
  moves activation across (needs R2 live first).

## 6. Decisions (answered by Cecilia, 2026-07-10)

- **Bin name: `aomi/bin/manager`.** Deliberately general — the second
  non-runtime service, intended to absorb more backend offloading over time,
  not just deploy control.
- **R2 provisioning: agent-driven via wrangler** (cloudflare-management
  setup), then implement Phase 3 against the real bucket.
- **Status transport: keep polling.** Polls are ~one DB read now; SSE only if
  volume ever warrants it.
- **Partner-scoped bearers: before the first partner onboards**, as its own
  designed change — not folded into the Phase 1 diff.

## 7. Remaining open questions

- Reconciler trust window (currently 30 min, `CI_INFLIGHT_TRUST_SECS`) and
  whether the projection freshness timestamp is surfaced in the UI or only in
  payloads.
- Whether the App-slug-per-platform column lands with Phase 3 or 4.
- Partner-bearer claims shape (platform id only, or source-id allowlist).
