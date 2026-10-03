# Issue 696 verification evidence

Companion PRs: [frontend #699](https://github.com/aomi-labs/aomi/pull/699) and
[backend #1232](https://github.com/aomi-labs/product-mono/pull/1232).

## Final uncertain-admission follow-up

Stop remains visible after an uncertain start acknowledgment. Recovery walks
bounded history, then replays the original intent, idempotency key and funding
selection to obtain its exact admitted turn. Failed/repeated Stop stays scoped
to that identity; unrelated/newer turns keep running. An unadmitted idle request
is not replayed solely to cancel it. Repeated Stop callers share error feedback.

Backend source `a28d3b5ace71970708664f1ddc2bee276dd2cc9a` adds the necessary
paired guest fix: an existing request replay returns before the new-admission
active-turn quota. New keys still enforce quota and release denied claims.
The PostgreSQL regression and every job in
[backend CI](https://github.com/aomi-labs/product-mono/actions/runs/37123810900)
passed. No API/schema or migration changed.

Managed local checks passed **69 tests**, including **22 SDK terminal/ownership
cases**, plus SDK/library typechecks and scoped ESLint. Chromium desktop and
mobile passed all scenarios; this directory contains **28 screenshots** and the
successful request report. Its tested runtime source is
`24f398f38aed025f769511fef0acb54d1bff822f`. Later changes only correct the separate
production-browser upstream fixture and strengthen its renewal assertion.

The earlier [frontend CI run](https://github.com/aomi-labs/aomi/actions/runs/37124644965)
passed packages, consumer compatibility, apps and guest Chromium. Its production
browser failure was traced to an invalid fixture: the second response reused
sequences 1–3 in the same session after a successful 401 → token renewal → 200.
The baseline SDK already rejects nonmonotonic events; the new Stop behavior
exposed that hidden rejection. The corrected fixture keeps conversation-wide
sequences/history/cursors, and the renewal test now requires the second reply.
The immutable consumer source and public ordering checks remain unchanged.
Consult the PR checks for final-head production-browser verification.

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

| Scenario                                                | Desktop                                            | Mobile                                            |
| ------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| Edit original request                                   | [Edit](desktop-edit.png)                           | [Edit](mobile-edit.png)                           |
| Rerun edited request                                    | [Rerun](desktop-rerun-edited.png)                  | [Rerun](mobile-rerun-edited.png)                  |
| Partial streamed response                               | [Streaming](desktop-streaming.png)                 | [Streaming](mobile-streaming.png)                 |
| Immediate disabled icon-only Stop feedback              | [Pending Stop](desktop-stopping.png)               | [Pending Stop](mobile-stopping.png)               |
| Frozen partial response after acknowledgment            | [Stopped](desktop-stopped.png)                     | [Stopped](mobile-stopped.png)                     |
| Failed Stop with retry                                  | [Retry](desktop-stop-retry.png)                    | [Retry](mobile-stop-retry.png)                    |
| Stop before delayed start acknowledgment                | [Early Stop](desktop-early-stopped.png)            | [Early Stop](mobile-early-stopped.png)            |
| Durable edited conversation after reload                | [Reload](desktop-reloaded.png)                     | [Reload](mobile-reloaded.png)                     |
| Stop racing with completion: answer and Rerun preserved | [Complete](desktop-stop-completed-race.png)        | [Complete](mobile-stop-completed-race.png)        |
| Stop racing with failure: Failed state preserved        | [Failed](desktop-stop-failed-race.png)             | [Failed](mobile-stop-failed-race.png)             |
| Uncertain admitted start: failed Stop stays actionable  | [Recovery retry](desktop-uncertain-stop-retry.png) | [Recovery retry](mobile-uncertain-stop-retry.png) |
| Retried Stop acknowledges the exact recovered turn      | [Recovered Stop](desktop-uncertain-stopped.png)    | [Recovered Stop](mobile-uncertain-stopped.png)    |

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

## October 3 review follow-up

The backend now acknowledges its actual durable terminal state with scoped
`terminal_turn`. Only an interruption winner sets `stopped_turn_id` and freezes
output. Complete/failed winners keep answer content, response identity and the
normal final-answer drain, including bounded history and callback responses.
An older acknowledgment cannot stop a newer active turn. Definitively rejected
starts no longer report a misleading Stop failure.

Backend regressions cover both winners of the completion/Stop SQL race, terminal
acknowledgments beyond a 1,001-event history, active/queued cancellation-token
scope, unrelated-notification filtering, and edited input retained exactly once
when cancelled before provider execution. The SQL race exposed a stale snapshot
edge after a concurrent row-lock winner; a scoped fresh-snapshot fallback fixes
that edge without changing the normal single-roundtrip path.

Source revision `fbdc45aec3e33df3954dfceed6db08998904cfbd` passed the full
[frontend CI](https://github.com/aomi-labs/aomi/actions/runs/37121382206)
and [preview E2E](https://github.com/aomi-labs/aomi/actions/runs/37121382119).
Workspace results: **1,933 passed, 2 skipped**, including all 14 SDK terminal-race
and 6 React terminal-projection cases. Lint, types, publishable package builds,
Portal/app checks and builds, dependency boundaries, packed consumer compatibility,
guest Chromium and production browser contracts passed.

Backend source `491a1abd6da6f14f54b5529deec9d8e756595b88` passed the
[exact-head Rust and multi-server E2E checks](https://github.com/aomi-labs/product-mono/actions/runs/37121330421):
**114 runtime tests** passed. The local pipeline suite passed **109 tests**,
including **21 real PostgreSQL integration tests**. Canonical frontend API
comparison against the compiled backend export also passed.

The executor disconnected during the local runtime build, which ended with a
broken output pipe. Equivalent exact-head backend CI passed; this interrupted
local attempt is not reported as a local runtime pass. Subsequent local UI jobs
failed disk admission until cleanup of artifacts created only by that aborted
runtime job. Saved resource policy and database contents were not changed.

All **32 widget trace/row regressions** passed. Four older expectations were
updated to distinguish Failed from Stopped. Desktop and mobile Chromium passed
every scenario, including complete/failed bounded ACKs without terminal events,
final answer identity and Rerun preservation, repeated clicks, early Stop, failed
Stop/retry, partial/tool streaming, and history reload. All **24 screenshots**
were refreshed or retained when pixel-identical. The exact browser-tested source
is `13c5a313dc25bd50baf382739740fe51bea000b0`; the only source difference from
the green `fbdc45ae` CI revision is those corrected widget test expectations.
The subsequent evidence commit changes only this report and screenshot artifacts.

## Earlier verification and remaining integration limits

| Check                                                                                                         | Result                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pinned cloud setup acceptance                                                                                 | PASS                                                                                                                                                                                                                                     |
| SDK/React branch, event projection, edit/rerun, early/repeated/failed Stop regressions                        | 67 passed                                                                                                                                                                                                                                |
| SDK, library and Portal typechecks                                                                            | PASS                                                                                                                                                                                                                                     |
| Workspace ESLint and dependency boundaries                                                                    | PASS                                                                                                                                                                                                                                     |
| Canonical API schema comparison with compiled backend export                                                  | PASS                                                                                                                                                                                                                                     |
| Account topology / preview origin / Portal proxy / Build BFF unit tests with runtime-only environment removed | 69 passed                                                                                                                                                                                                                                |
| Widget row/trace regressions, including older interrupted rows while a later turn runs/completes              | 29 passed; scoped ESLint also passed                                                                                                                                                                                                     |
| Packed consumer and production browser contracts                                                              | PASS in GitHub CI on source revision 38debb2f; final head status linked in PR                                                                                                                                                            |
| Local broad workspace suite                                                                                   | 1,888 passed, 8 failed, 3 skipped; one OAuth suite could not collect without its disposable test DB. The 8 unrelated URL-dependent failures passed in the isolated 69-test rerun. CI supplies its disposable DB.                         |
| Backend runtime/pipeline/SQL tests                                                                            | 112 runtime tests passed in CI on earlier source revision; 19 local pipeline tests passed before the final callback-origin case, which separately passed against PostgreSQL on corrected source. See backend PR #1232 for final head/CI. |
| Full local Portal host                                                                                        | BLOCKED by managed memory limits: webpack heap OOM and Turbopack process-tree ceiling                                                                                                                                                    |
| Real authenticated BFF/backend/provider browser story                                                         | BLOCKED: complete runtime never reached readiness and no test identity/provider session was established                                                                                                                                  |
| Real chain execution / funds                                                                                  | Not performed                                                                                                                                                                                                                            |

An earlier frontend Apps CI attempt failed in an unchanged OAuth schema teardown
suite (`schema … does not exist`); that same suite passed on the next source
revision. This was not changed as part of issue 696. Consult final PR checks for
the latest app build outcome rather than treating an earlier run as current.

Vercel's backend preview was blocked because GitHub could not verify the commit
author's account; [the bot comment](https://github.com/aomi-labs/product-mono/pull/1232#issuecomment-5956380706)
records that external account-verification gate. No account permissions, branch
protections or deployment settings were changed. PR readiness is controlled by the user; consult their current status before merging.

## Saved cloud environment friction

Only normal runtime startup and task-generated build/cache cleanup were used.
Saved environment configuration and resource policy were not changed.

| Friction                                                | Observed effect                                                                                                                                                                                      | Suggested future environment improvement                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| PostgreSQL initially stopped                            | About 2 minutes to inspect and start the existing cluster                                                                                                                                            | Check database readiness at startup                                  |
| Repowiki wrapper invoked raw Cargo                      | Roughly 10 minutes and 12 GiB of task-created ignored build output before stopping it                                                                                                                | Prebuild documentation lookup or route it through managed tooling    |
| Cold Rust feature graphs                                | Initial runtime check 31m45s; pipeline build about 16m19s; API export about 8 minutes; final focused PostgreSQL regression rebuilt dependencies for 16m14s after disk cleanup. Some work overlapped. | Prewarm runtime, pipeline and API-export feature graphs              |
| Cargo artifact growth vs disk admission reserve         | Subsequent checks queued despite approximately 21 GiB free; safe GC did not reclaim the active cache                                                                                                 | Budget growth and reclaim obsolete feature variants                  |
| Reclaimable file cache counted against available memory | UI/API jobs queued while little process memory was in use                                                                                                                                            | Account for reclaimable page cache in admission decisions            |
| Full Portal compilation                                 | Several attempts exceeded managed memory/heap budgets                                                                                                                                                | Reserve sufficient Portal build memory or provide a prebuilt host    |
| Playwright browser mismatch                             | Requested downloaded headless shell was absent; installed system Chromium worked                                                                                                                     | Install the matching browser or document the system-browser fallback |
| Google Fonts unavailable during local compilation       | Browser evidence uses system-font fallback                                                                                                                                                           | Cache build-time fonts                                               |
| Shell GitHub REST access forbidden                      | Connected GitHub tools were used for issues, PRs and CI                                                                                                                                              | Document the supported connector path                                |

Cleanup was restricted to task-created failed Next output, an unmanaged task
target directory, and obsolete task-created Cargo variants. A read-only page
cache eviction hint retained all cached file contents. No shared database was
reset and no saved runtime budget was raised.
