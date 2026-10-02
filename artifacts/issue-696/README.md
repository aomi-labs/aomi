# Issue 696 verification evidence

Draft PRs: [frontend #699](https://github.com/aomi-labs/aomi/pull/699) and
[backend #1232](https://github.com/aomi-labs/product-mono/pull/1232).

## Browser evidence

Screenshots show the actual shared AomiFrame, Thread, React runtime and SDK
mounted in the committed Vite harness. REST, identity availability and model
output are synthetic fixtures; streaming uses local HTTP SSE. The visible
fixture disclosure is intentional. This is **not a real authenticated BFF →
backend → model-provider integration pass**. Wallets remained disconnected;
no signing or real funds were used.

The exact tested source revision, browser version, per-viewport scenarios,
request counts and timings are in [browser-report.json](browser-report.json).
Desktop is 1440 × 1000; mobile is 390 × 844 with touch enabled. Timings include
a synthetic 650 ms Stop acknowledgment delay and do not measure a real provider.

| Scenario | Desktop | Mobile |
| --- | --- | --- |
| Edit original request | [Edit](desktop-edit.png) | [Edit](mobile-edit.png) |
| Rerun edited request | [Rerun](desktop-rerun-edited.png) | [Rerun](mobile-rerun-edited.png) |
| Partial streamed response | [Streaming](desktop-streaming.png) | [Streaming](mobile-streaming.png) |
| Immediate disabled icon-only Stop feedback | [Pending Stop](desktop-stopping.png) | [Pending Stop](mobile-stopping.png) |
| Frozen partial response after acknowledgment | [Stopped](desktop-stopped.png) | [Stopped](mobile-stopped.png) |
| Failed Stop with retry | [Retry](desktop-stop-retry.png) | [Retry](mobile-stop-retry.png) |
| Stop before delayed start acknowledgment | [Early Stop](desktop-early-stopped.png) | [Early Stop](mobile-early-stopped.png) |
| Durable edited conversation after reload | [Reload](desktop-reloaded.png) | [Reload](mobile-reloaded.png) |

The runner verifies triple Rerun and double edit Save create one request each,
Rerun after edit uses revised text, triple Stop creates one interruption,
thinking-only and partial/tool streaming stops settle, stale deltas stay out,
failed Stop remains retryable, an early Stop waits for the correct accepted turn,
and a bounded acknowledgment works without fabricating an event/cursor.

The user-requested visual refinement removes visible pending text. The circular
Stop icon stays the same size and uses the existing subtle disabled appearance.
Browser assertions verify no visible text, unchanged dimensions, disabled state,
`aria-busy` and the nonvisual pending accessible label, alongside the repeated
click checks. Both desktop and mobile passed after this refinement. Scoped
ESLint, library typecheck and all 21 affected interruption/intent tests passed.
The supplied Library reference was resolved, but its pixels could not be
downloaded or rendered on this executor; the explicit textual requirement was
used without claiming visual comparison to that reference.

Reproduce from this repository using the pinned cloud environment:

```sh
source /workspace/.tooling/product-mono-d34ea6137f3aa5029b4c3551b16ac7525ff97e52/.codex/scripts/cloud-env.sh
aomi-dev exec --repo frontend --env PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium -- node scripts/test-chat-turn-controls.mjs --harness
```

## Verification and limits

| Check | Result |
| --- | --- |
| Pinned cloud setup acceptance | PASS |
| SDK/React branch, event projection, edit/rerun, early/repeated/failed Stop regressions | 67 passed |
| SDK, library and Portal typechecks | PASS |
| Workspace ESLint and dependency boundaries | PASS |
| Canonical API schema comparison with compiled backend export | PASS |
| Account topology / preview origin / Portal proxy / Build BFF unit tests with runtime-only environment removed | 69 passed |
| Widget row/trace regressions, including older interrupted rows while a later turn runs/completes | 29 passed; scoped ESLint also passed |
| Packed consumer and production browser contracts | PASS in GitHub CI on source revision 38debb2f; final head status linked in PR |
| Local broad workspace suite | 1,888 passed, 8 failed, 3 skipped; one OAuth suite could not collect without its disposable test DB. The 8 unrelated URL-dependent failures passed in the isolated 69-test rerun. CI supplies its disposable DB. |
| Backend runtime/pipeline/SQL tests | 112 runtime tests passed in CI on earlier source revision; 19 local pipeline tests passed before the final callback-origin case, which separately passed against PostgreSQL on corrected source. See backend PR #1232 for final head/CI. |
| Full local Portal host | BLOCKED by managed memory limits: webpack heap OOM and Turbopack process-tree ceiling |
| Real authenticated BFF/backend/provider browser story | BLOCKED: complete runtime never reached readiness and no test identity/provider session was established |
| Real chain execution / funds | Not performed |

An earlier frontend Apps CI attempt failed in an unchanged OAuth schema teardown
suite (`schema … does not exist`); that same suite passed on the next source
revision. This was not changed as part of issue 696. Consult final PR checks for
the latest app build outcome rather than treating an earlier run as current.

Vercel's backend preview was blocked because GitHub could not verify the commit
author's account; [the bot comment](https://github.com/aomi-labs/product-mono/pull/1232#issuecomment-5956380706)
records that external account-verification gate. No account permissions, branch
protections or deployment settings were changed. Both PRs remain drafts.

## Saved cloud environment friction

Only normal runtime startup and task-generated build/cache cleanup were used.
Saved environment configuration and resource policy were not changed.

| Friction | Observed effect | Suggested future environment improvement |
| --- | --- | --- |
| PostgreSQL initially stopped | About 2 minutes to inspect and start the existing cluster | Check database readiness at startup |
| Repowiki wrapper invoked raw Cargo | Roughly 10 minutes and 12 GiB of task-created ignored build output before stopping it | Prebuild documentation lookup or route it through managed tooling |
| Cold Rust feature graphs | Initial runtime check 31m45s; pipeline build about 16m19s; API export about 8 minutes; final focused PostgreSQL regression rebuilt dependencies for 16m14s after disk cleanup. Some work overlapped. | Prewarm runtime, pipeline and API-export feature graphs |
| Cargo artifact growth vs disk admission reserve | Subsequent checks queued despite approximately 21 GiB free; safe GC did not reclaim the active cache | Budget growth and reclaim obsolete feature variants |
| Reclaimable file cache counted against available memory | UI/API jobs queued while little process memory was in use | Account for reclaimable page cache in admission decisions |
| Full Portal compilation | Several attempts exceeded managed memory/heap budgets | Reserve sufficient Portal build memory or provide a prebuilt host |
| Playwright browser mismatch | Requested downloaded headless shell was absent; installed system Chromium worked | Install the matching browser or document the system-browser fallback |
| Google Fonts unavailable during local compilation | Browser evidence uses system-font fallback | Cache build-time fonts |
| Shell GitHub REST access forbidden | Connected GitHub tools were used for issues, PRs and CI | Document the supported connector path |

Cleanup was restricted to task-created failed Next output, an unmanaged task
target directory, and obsolete task-created Cargo variants. A read-only page
cache eviction hint retained all cached file contents. No shared database was
reset and no saved runtime budget was raised.
