---
title: Frontend Compatibility Invariants
owner: frontend
status: authoritative
area: development
review_after_days: 30
sources_of_truth:
  - scripts/check-consumer-compatibility.mjs
  - scripts/check-consumer-compatibility-baseline.mjs
  - .github/workflows/ci.yml
  - .github/CODEOWNERS
  - apps/widget-consumer/package.json
  - apps/examples/headless-client/package.json
---

# Frontend Compatibility Invariants

Existing integrations must keep working when their installed Aomi packages
change. Implementation can change freely while these contracts hold.
Frontend owners: @CeciliaZ030 and @arixoneth.

| Rule        | Contract                                                                                       | Enforcement                                                                |
| ----------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| SDK-01      | Existing headless consumer imports and calls still compile against the shipped client package. | Packed-package consumer check.                                             |
| WIDGET-01   | The existing widget consumer still builds with the shipped widget and React packages.          | Packed-package consumer check.                                             |
| CONSUMER-01 | A PR cannot hide a break by rewriting its consumers.                                           | Extract consumers from the event's trusted base commit, never the PR tree. |
| TEST-01     | Compatibility failures or missing prerequisites block merging.                                 | Required `Frontend CI Passed` aggregate checks `consumer-compat` success.  |
| OWNER-01    | Consumer, harness, and CI protection changes require frontend-owner review.                    | CODEOWNERS plus GitHub required code-owner approval.                       |

Run `pnpm run test:contracts -- --base <trusted-base-sha>` from the checkout.
The check builds candidate packages, packs them, and installs them into temporary
consumer directories outside the monorepo. The original source and build scripts
come from the trusted base. Workspace dependency references are replaced with
candidate tarballs and source aliases are removed so unpublished source cannot
make a broken package pass. The widget fixture retains two peers previously
supplied by the monorepo: assistant-ui from the trusted root manifest and
SPL Token from the trusted widget development manifest. These fixed allowances
preserve the existing fixture environment; they do not establish that the
example manifest alone contains every dependency a fresh host needs.
The headless tests and SDK
ESM/CJS imports also run against the installed package. No login credentials
or running backend are needed.
CI uses the PR base SHA, or the previous commit from a push event. A missing or
invalid baseline fails rather than falling back to candidate consumers.

Before editing, identify affected rules. Before finishing, report the baseline,
checks run, public contract changes, and remaining coverage limits. To add a
feature, preserve the existing supported integration. Deliberate breaking
migrations need a separate owner-reviewed compatibility/release decision; do
not weaken this check to pass an ordinary refactor.

CODEOWNERS alone does not enforce review: `main` must require code-owner approval
and `Frontend CI Passed` in GitHub branch protection. Keep stale approval
dismissal enabled. The baseline and enforcement files are themselves owned.

These checks establish package and consumer compatibility for the exercised
examples. They do not prove browser login, signing, real-provider availability,
or every SDK/CLI behavior; those require their own tests.
