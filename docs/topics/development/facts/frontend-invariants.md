---
title: Frontend Compatibility Invariants
owner: frontend
status: authoritative
area: development
review_after_days: 30
sources_of_truth:
  - scripts/check-consumer-compatibility.mjs
  - scripts/check-consumer-compatibility-baseline.mjs
  - scripts/check-frontend-boundaries.mjs
  - scripts/test-browser-contracts.mjs
  - .github/scripts/select-ci-paths.mjs
  - .github/workflows/ci.yml
  - .github/CODEOWNERS
  - apps/widget-consumer/package.json
  - apps/examples/headless-client/package.json
  - apps/shadcn-registry/src/host-composition.ts
  - apps/portal/src/components/shell/portal-aomi-frame.tsx
---

# Frontend Compatibility Invariants

Existing integrations must keep working when their installed Aomi packages
change. Implementation can change freely while these contracts hold.
Frontend owners: @CeciliaZ030 and @arixoneth.

| Rule         | Contract                                                                                                                  | Enforcement                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| SDK-01       | Existing headless consumer imports and calls still compile against the shipped client package.                            | Packed-package consumer check.                                             |
| WIDGET-01    | Existing `<AomiWidget>` integrations work without new mandatory host providers or setup calls.                            | Trusted-base packed widget consumer build.                                 |
| SHARED-UI-01 | Reusable chat, account, settings, usage, and Library UI has one implementation in `apps/shadcn-registry`.                 | Portal imports the explicit `host-composition` package entrypoint.         |
| HOST-01      | Portal may compose `AomiFrame`; it need not render public `AomiWidget` or copy its host policy.                           | Portal frame tests plus dependency-boundary check.                         |
| DIRECTION-01 | Portal cannot import private widget source; widget cannot import Portal; packages cannot depend on app UI.                | `check:frontend-boundaries` in the required packages job.                  |
| AUTH-01      | Public credentials terminate at the BFF; internal backend assertions are server-minted and fail closed.                   | Production Portal browser contracts verify signed assertions and headers.  |
| AUTH-02      | EVM/SVM sign-in and wallet linking resolve one canonical account; rejected, replayed, or wrong-origin proofs fail closed. | Production wallet-provider browser contracts against disposable Postgres.  |
| GUEST-01     | Portal may recover cookie-owned guest history; anonymous cross-origin widgets do not persist it by default.               | Portal guest test plus packaged cross-origin browser contracts.            |
| CONSUMER-01  | A PR cannot hide a break by rewriting its consumers.                                                                      | Extract consumers from the event's trusted base commit, never the PR tree. |
| INSTALL-01   | Published packages install without undeclared workspace or hoisted dependencies; public entries and the SDK CLI load.     | Synthetic isolated clean install from candidate tarballs.                  |
| VISUAL-01    | Chat, account, settings, usage, and wallet-review surfaces keep their reviewed production layout.                         | Deterministic production-build Playwright image contracts.                 |
| ACTION-01    | Wallet Actions require an explicit choice and remain durable, idempotent, and fail closed across errors and reloads.      | Controlled-upstream browser Action lifecycle contract.                     |
| TEST-01      | Compatibility failures, omitted browser scenarios, or missing prerequisites block merging.                                | Required `Frontend CI Passed` aggregate checks all dependency jobs.        |
| OWNER-01     | Consumer, boundary, harness, and CI protection changes require frontend-owner review.                                     | CODEOWNERS plus GitHub required code-owner approval.                       |

## Shared UI and host policy

`@aomi-labs/widget-lib/host-composition` is the intentional contract for
first-party hosts that assemble `AomiFrame`. Keep the entrypoint curated: add a
shared export because a host needs the shared implementation, not as a shortcut
around package ownership. Portal-local routes, BFF handlers, URL handoffs,
session integration, transport selection, and persistence policy stay in
`apps/portal`.

The public `AomiWidget` owns its wallet providers, widget authentication, and
cross-origin transport. `PortalAomiFrame` owns first-party composition and its
cookie-aware guest policy. Both consume the same reusable UI without forcing
these legitimate host differences into one component.

Do not add Portal forwarding files, relative imports into
`apps/shadcn-registry/src`, or Portal imports through the widget's internal
`@/components`, `@/hooks`, and `@/lib` aliases. Those aliases exist only so the
widget source graph can compile inside the Portal workspace.

## Authentication and transport

First-party cookies, origin-bound widget sessions, OAuth access tokens, opaque
Better Auth session bearers, and server-minted internal assertions are distinct
credentials. Browser code must not import service assertion signing. The BFF
validates the caller and requested resource/scope, allowlists forwarded headers,
strips incoming authorization and cookies before the backend hop, and mints the
internal assertion server-side. An invalid explicit credential must not fall
back to a weaker identity.

## Packaged compatibility

Run `pnpm run test:contracts -- --base <trusted-base-sha>` from the checkout.
The check builds candidate packages, packs them, and installs them into temporary
consumer directories outside the monorepo. The original source and build scripts
come from the trusted base. Workspace dependency references are replaced with
candidate tarballs and source aliases are removed so unpublished source cannot
make a broken package pass. The immutable widget fixture retains two
dependencies previously supplied by the monorepo so the historical consumer is
reproduced exactly. A separate isolated clean-install fixture starts from only the
public widget plus React, resolves the complete candidate package stack from
tarballs, loads the widget, React runtime, client, and deploy lifecycle entries,
and executes the packed SDK CLI. Third-party peer-range warnings remain visible
but do not mask whether Aomi's own files and exports work. The headless tests and
SDK ESM/CJS imports also run against the installed package. No login credentials
or running backend are needed.

CI uses the PR base SHA, or the previous commit from a push event. A missing or
invalid baseline fails rather than falling back to candidate consumers.

## Conditional CI selection

The required `Frontend CI Passed` check always runs, but expensive dependency
jobs run only when their owned paths or a shared dependency changed. Portal and
Build changes select their preview smoke; Portal and widget/auth changes select
the relevant browser contracts; publishable package changes select packed
consumer compatibility. Plain documentation and historical work-log changes do
not run product builds. Landing content under `apps/landing/content` is product
input and still selects Landing.

Lockfiles, root build configuration, shared source, selector changes, unknown
paths, unavailable comparisons, and every production candidate default to the
full check set. The aggregate requires selected jobs to succeed and unselected
jobs to be explicitly skipped, so a selector failure or unexpected skip cannot
produce a green required check. Keep path-selection cases in
`tests/contracts/ci-path-selection.test.mjs` whenever ownership changes.

## Production browser contracts

Run `CONSUMER_BASE_SHA=<trusted-base-sha> pnpm run test:browser:contracts` to
exercise a production Portal build and an immutable trusted-base Vite consumer
installed against candidate package tarballs. The harness creates a disposable
Postgres container, applies the canonical account-schema fixture and current
Better Auth migrations, generates ephemeral EVM/SVM keys, and starts a
controlled upstream that cryptographically verifies the Portal's internal BFF
JWT. It fails if any mandatory Playwright case is missing, skipped, flaky, or
unexpected.

The Portal cases cover EVM and SIWS sign-in, reload persistence, explicit wallet
linking, signature rejection, sign-out/account switching, canonical identity,
history isolation, completed chat, the allowlisted BFF hop, deterministic visual
baselines, and a durable wallet Action through local handoff failure, rejection,
idempotent replay, stale-result rejection, and reload. The packaged
widget cases cover real preflight/CORS behavior, guest nonpersistence, invalid
explicit WST fail-closed behavior, readable origin rejection, session renewal,
wallet-authenticated persistence, nonce replay/origin binding, canonical account
resolution, completed turns, and selected upstream error headers.

Before editing, identify affected rules. Before finishing, report the baseline,
checks run, public contract changes, and remaining coverage limits. To add a
feature, preserve the existing supported integration. Deliberate breaking
migrations need a separate owner-reviewed compatibility/release decision; do
not weaken this check to pass an ordinary refactor.

CODEOWNERS alone does not enforce review: `main` must require code-owner approval
and `Frontend CI Passed` in GitHub branch protection. Keep stale approval
dismissal enabled. The baseline and enforcement files are themselves owned.

These checks establish package and consumer compatibility for the exercised
examples and prove the listed cross-origin browser-to-BFF journeys. Browser
wallets are standards-compatible injected fixtures with ephemeral keys, not
real extension or embedded-provider accounts. The controlled upstream validates
identity and protocol transport but does not replace a hosted backend smoke.
The suite never signs transactions or broadcasts. It is not a real-provider-
availability or full backend-migration test; the separate hosted-wallet workflow
remains the staging-provider/backend check.
