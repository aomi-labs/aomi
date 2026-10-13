# scripts

Run every script from the repository root. Callers are root `package.json`
scripts unless noted.

## ci/ — CI gates and test harnesses

| Script                                      | Caller                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `check-frontend-boundaries.mjs` (+ test)    | `check:frontend-boundaries`; CI `packages` job                         |
| `check-test-results.mjs` (+ test)           | CI `packages` and `apps` jobs (verifies vitest JSON reports)           |
| `check-consumer-compatibility.mjs`          | `test:contracts`; CI `consumer-compat`; `browser-hosts.mjs`            |
| `check-consumer-compatibility-baseline.mjs` | imported by `check-consumer-compatibility.mjs`, `tests/contracts`      |
| `consumer-lockfile.mjs`                     | imported by the consumer-compatibility scripts, `tests/contracts`      |
| `test-browser-contracts.mjs`                | `test:browser:contracts`; CI `browser-contracts`                       |
| `test-packed-consumers.mjs`                 | `test:browser:consumers`; CI `packed-consumers`                        |
| `browser-hosts.mjs`                         | imported by the two browser runners above                              |
| `performance/capture-ui.ts`                 | `test-packed-consumers.mjs`                                            |
| `test-live-backend-openapi.mjs`             | `test:openapi:live`; CI `promotion-policy`, `live-production-contract` |

## release/ — publishing and deploy

| Script                                          | Caller                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `publish-package-if-needed.mjs` (+ test)        | `publish-npm-token.yml`, `publish-npm-oidc-canary.yml`, `publish-tagged-packages.mjs` |
| `publish-tagged-packages.mjs`                   | `publish-npm-tag.yml`                                                                 |
| `publish-policy.test.mjs`                       | workspace vitest (covers the publish scripts and `.github/scripts/verify-main-ci.sh`) |
| `check-package-changesets.mjs` (+ test)         | `check:package-changesets`; `widget-package-contracts.yml`                            |
| `check-package-api.mjs`                         | `check:package-api`; `widget-package-contracts.yml`                                   |
| `check-fresh-widget.mjs`                        | `check:fresh-widget`; `widget-package-contracts.yml`                                  |
| `check-widget-docs.mjs`                         | `check:widget-docs`; `check-fresh-widget.mjs`                                         |
| `prepare-fresh-widget-next.mjs`                 | `check-fresh-widget.mjs`, `ci/browser-hosts.mjs`                                      |
| `fixtures/widget-consumer/`                     | `check-fresh-widget.mjs`                                                              |
| `build-vercel-app.mjs` + `vercel-projects.json` | `vercel-build` (Vercel `buildCommand` in `vercel.json`)                               |

## codegen/ — generated sources

| Script                                                             | Caller                                          |
| ------------------------------------------------------------------ | ----------------------------------------------- |
| `generate-agent-api-contract.mjs` / `check-agent-api-contract.mjs` | `generate:agent-api` / `check:agent-api`        |
| `update-backend-openapi.mjs`                                       | `update:backend-openapi`                        |
| `sync-db-pool-budgets.mjs`                                         | `sync:db-pool-budgets`, `check:db-pool-budgets` |
| `generate-theme.mjs`                                               | `generate:theme`                                |
| `generate-app-marks.mjs`, `generate-skill-marks.mjs`               | `generate:marks`                                |

## dev/ — local stacks and smokes

| Script                   | Caller                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| `dev-auth-stack.sh`      | `dev:auth-stack`, `dev:auth-stack:status`, `dev:auth-stack:stop` |
| `dev-landing-ngrok.sh`   | `dev:landing:ngrok`                                              |
| `smoke-auth-stack.mjs`   | `smoke:auth-stack`                                               |
| `smoke-local-runtime.ts` | `smoke:local-runtime`                                            |

## Top level

- `repowiki` — `repowiki`, `repowiki:refresh`, `repowiki:doctor`. Stays at
  `./scripts/repowiki` because the shared repowiki skills call that path.
