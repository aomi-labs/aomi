---
title: Independent frontend release implementation
owner: frontend
status: awaiting-review-and-staging-verification
area: development
created: 2026-10-20
---

# Independent frontend releases

This implementation is not operationally verified or approved for production cutover. It accompanies product-mono #1385 and the Phase 1 plan #1384. Cecilia review is required before enabling the changed production paths. The existing `release/* -> prod` source policy is retained unchanged: reviewed main ancestry, prod-only divergence checks, exact merge tree, live production API check and required aggregate CI. Merging source may build held deployments for several surfaces; a domain operation selects only one surface.

`promote-frontend.yml` and `rollback-frontend.yml` select Portal, Build, Landing or Telegram and one exact READY production deployment ID. They require the deployment's source to have a merged first-party `release/* -> prod` approval and successful policy/aggregate checks, then test the selected candidate's requirements against `https://api.aomi.dev` using the trusted current checker. Rollback requires only the selected surface target, plus its deployment-bound QA run. Neither needs a backend ReleaseSet or a backend soak.

Production builds must have automatic custom-domain assignment disabled. The script reads canonical custom/project aliases for every active surface before and after the selected provider-native operation. It refuses wrong-project or preview builds, requires exact source provenance, and fails if any unrelated alias changes. The two workflows share the global frontend routing concurrency group because these before/after comparisons span surfaces.

## API compatibility

Live route policy is **consumer required method/path/auth ⊆ target backend provided method/path/auth**. Unrelated backend routes and their auth annotations do not affect the check. The selected candidate's committed OpenAPI fixture supplies its route and critical request/response requirements on promotion and rollback; the old candidate's checker is never run. Request values must fit backend input requirements; backend response values must satisfy consumer field/type/required/enum/nullability expectations. Unsupported schema constraint changes fail conservatively rather than being silently ignored.

The offline generated-client equality check is intentionally retained: it checks that the committed generated route inventory matches its committed backend fixture. It is not a backend RC gate and does not fetch current backend state. Additive backend route, missing required method/path, changed auth, required request field and response shape regressions have separate tests.

Endpoint removal on a backend can break deployed frontends. Migrate consumers first or retain the old endpoint temporarily. This is an operational mitigation; it creates no cross-repository backend hard gate.

## QA and remaining blockers

The aomi-qa frontend workflow supplies exact-deployment public browser smoke. It must not be mistaken for live OAuth, wallet or authenticated application journeys. The smoke reports `authenticated_journeys=NOT_RUN`; non-Landing operations explicitly require PASS for those journeys, so they remain blocked until their deployment-bound evidence is implemented. The smoke's API target identifies the intended live contract check and is not proof of the deployment's actual BFF/build backend configuration. Actual target configuration verification is also required before cutover.

Still required: hosted selected-surface rehearsals, exact-deployment authenticated QA, actual target-backend configuration proof, Vercel setting/alias propagation and retry verification, frontend-owner approval, credential access verification and retirement of the old product-mono whole-product frontend promotion at reviewed cutover. No production mutation was executed in this task.

## Verification

- 10 OpenAPI route/compatibility regression tests passed.
- 57 native contract/workflow tests passed, including four-surface independent operations and unrelated-alias invariance simulations.
- Library TypeScript passed through aomi-dev after installing this checkout's pinned dependencies.
- Workflow security policy, release-note guard and formatting passed.
- No live Vercel mutation/read-back rehearsal or authenticated browser journey ran. No npm package was published.

Shared integration checklist and backend readiness are maintained in product-mono `docs/topics/deployments/facts/phase1-implementation-status.md`; no Phase 1 completion is claimed.

The live contract reads Backend `/api/openapi.json` and Manager `/api/manager/openapi.json` from the same target origin. Their actual documents are composed without dropping Manager requirements; conflicting auth definitions block. The first staging execution exposed 82 missing Manager requirements; after adding the backend provider implementation, staging remains BLOCKED by its undeployed Manager document (HTTP 404). Two local HTTP integration tests pass for separate providers/backend additions and missing Manager evidence. Backend endpoint/Worker changes are in product-mono #1385; browser evidence is in aomi-qa #6.

Before a production-source PR can merge, its existing promotion-policy job now reads each active project's `autoAssignCustomDomains=false` setting using a read-only Vercel credential, after source/main/merge-tree checks and before dependency installation. Provider policy is checked again before and after a routing operation. A pre-mutation scalar record preserves the selected target and previous aliases if the provider operation is interrupted. The read-only credential's availability/permissions remain unverified; absence blocks this frontend policy, never backend RC.
