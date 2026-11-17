---
title: BFF Endpoints
owner: frontend
status: authoritative
area: bff
review_after_days: 30
sources_of_truth:
  - apps/edge/src/portal/routes.ts
  - apps/edge/src/auth/routes.ts
  - apps/edge/src/build/routes.ts
  - apps/edge/src/kernel/config.ts
---

# BFF Endpoints

The Edge Worker (`apps/edge`) serves the portal's server routes; the portal app is
pages only. They translate browser-facing portal calls into backend
requests: `/api/auth/widget/*` (widget sign-in), `/api/delegation/{para,privy}/*`,
`/api/public/catalog/[kind]`, `/api/dev/e2e/*` (test wallets) and the
`/api/[...slug]` proxy to the Rust backend, all in `apps/edge`. Public developer routes also live at
`/v1/agent/*`, `/v1/pipeline/*`, `/v1/agent/mcp`, and `/v1/pipeline/mcp`.
The deploy and launch routes below belong to Aomi Build, not the portal.

The two MCP paths are unversioned OAuth resources and require a valid exact-
resource token even for `initialize` and `tools/list`. `/api/mcp` and
`/api/mcp/direct` are removed, without aliases. REST accepts either the exact
resource OAuth grant or a first-party Better Auth session; anonymous/Bearer
sessions are bounded to the guest ceiling and are never tokenless requests.

Every public auth header is stripped before proxying. The portal sends only a
short-lived, operation-downscoped Aomi internal bearer to `api-server`, while
preserving the Gate F app-key, idempotency, payment, response-header, action,
and custody boundaries.

## Build launch endpoints

| Build BFF endpoint                  | Who calls it                      | Where it gets to, if any                                                                                                                                      | What it does                                                                                                                                                | Code path                                               |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/build/deployments/projects`   | GitHub-signed-in deploy dashboard | Rust backend `GET /api/integrations/github-app/user/projects?github_user_id[&platform]`                                                                       | Returns the signed-in user's projects across every bound platform. `?platform=` is an explicit narrowing filter, never a default.                           | `apps/build/src/app/api/build/deployments/projects/route.ts`  |
| `POST /api/build/deployments/create`    | One-click create-project step     | Rust backend `POST /api/integrations/github-app/platforms/:platform/projects/create-from-template`                                                            | Creates a GitHub repo from the configured template and persists the returned project.                                                                       | `apps/build/src/app/api/build/deployments/create/route.ts`    |
| `POST /api/build/deployments/preflight` | Launch deploy preview step        | Rust backend `POST /api/platforms/:platform/projects` when a repo stands in for a project, then `POST /api/platforms/:platform/deploy` with `preflight: true` | Creates/resolves the project (creation is the only step that takes a platform), then previews the deploy and returns the immutable source commit.           | `apps/build/src/app/api/build/deployments/preflight/route.ts` |
| `POST /api/build/deployments/deploy`    | Launch deploy step                | Rust backend `POST /api/platforms/:platform/deploy` with `preflight: false`                                                                                   | Applies a deploy for an owned `projectId`, pinned to the exact preflight commit. The platform is derived from the project's binding, never from the caller. | `apps/build/src/app/api/build/deployments/deploy/route.ts`    |
| `GET /api/build/deployments/status`     | Launch status polling             | Rust backend `GET /api/platforms/:platform/deployments/:deployment/status`                                                                                    | Polls deployment status; the backend resolves CI per poll.                                                                                                  | `apps/build/src/app/api/build/deployments/status/route.ts`    |
| `POST /api/build/deployments/activate`  | Launch activation step            | Rust backend `POST /api/platforms/:platform/apps/activate`                                                                                                    | Activates release tags for an owned `projectId` on the project's bound platform, after ownership + required-secret gates.                                   | `apps/build/src/app/api/build/deployments/activate/route.ts`  |
| `GET /api/build/deployments/apps`       | Launch live-app status polling    | Rust backend `GET /api/platforms/:platform/apps/:name` with optional `release_tag`                                                                            | Checks whether an owned app is active and loaded, on the owning project's platform.                                                                         | `apps/build/src/app/api/build/deployments/apps/route.ts`      |
| `POST /api/build/deployments/redeploy`  | Project page redeploy action      | Rust backend `GET /api/integrations/github-app/user/projects/:id/latest-deployment`, then backend deployment rerun                                            | Proves ownership, hydrates the project's backend-owned CI run, and asks the backend to rerun it. Returns `409` when no run is available.                    | `apps/build/src/app/api/build/deployments/redeploy/route.ts`  |

## Build release endpoints

`apps/edge/src/build/releases.ts` serves the release API on the Build host.
`/api/build/<path>` is the manager's `/api/<path>`, proxied with the raw body
(at most 10 MB, else `413 too_large`). The caller is a builder API key
(`Authorization: Bearer aomi_key_…`), a CLI bearer or the GitHub session
cookie; the manager receives a five-minute `role: "user"` builder bearer
(`principal_class: "builder"`), never the key. A key needs the route's
capability (else `403 insufficient_scope`) and its bearer carries the key's
capabilities; a session's bearer carries all five.

| Route | Manager | Key capability |
| --- | --- | --- |
| `POST /api/build/packages/:name/releases` | `POST /api/packages/:name/releases` (`application/x-tar`) | `package:publish` |
| `GET /api/build/packages/:name/releases` | `GET /api/packages/:name/releases` | none |
| `POST /api/build/packages/:name/promote` | `POST /api/packages/:name/promote` | `package:promote` |
| `POST /api/build/agents/:name/configs` | `POST /api/agents/:name/configs` | `agent:publish` |
| `GET /api/build/agents/:name/configs` | `GET /api/agents/:name/configs` | none |
| `POST /api/build/agents/:name/promote` | `POST /api/agents/:name/promote` | `agent:promote` |
| `GET /api/build/publishers/me` | `GET /api/publishers/me` | none |
| `GET /api/build/agents/:name` | `GET /api/agents/:name` | none |
| `GET /api/build/packages/:name` | `GET /api/packages/:name` | none |
| `PUT /api/build/packages/:name/secrets/:slot` | `PUT /api/packages/:name/secrets/:slot` | `package:secrets` |
| `DELETE /api/build/packages/:name/secrets/:slot` | `DELETE /api/packages/:name/secrets/:slot` | `package:secrets` |

The request keeps `content-type`, `x-aomi-source-repo` and
`x-aomi-source-commit`; cookies and the caller's `Authorization` are dropped.

## Operational Notes

- `/api/build/deployments/*` is Build's launch flow, served by the Edge Worker (`apps/edge/src/build/routes.ts`). Build also serves `/api/build/deployments/*` (project console) and `/api/build/deployments/{attempts,sdk-status}`.
- There is no `/sources` route family and no `app_source_id`: the persisted identity is the Project (`projectId`), and project-scoped reads never accept a caller platform — the backend derives each project's bound platform. See `docs/topics/deploy/facts/projects.md`.
- Onboarding backend calls use Build's service identity: `aomi-edge` mints a short-lived `service` bearer with `EDGE_SERVICE_PRIVATE_KEY`. The committed service-topology TOML is selected automatically from the backend target / Vercel environment.
- The Build onboarding BFF does not use `AOMI_ADMIN_SECRET` or `APP_DEPLOY_ACTIVATION_TOKEN`. The CLI publishes with a builder API key through the release endpoints above.
- Launch defaults are env-driven server-side config read in `apps/edge/src/kernel/config.ts`: `BUILD_DEFAULT_PLATFORM` (one platform slug), `BUILD_TEMPLATE_REPO` and `BUILD_CREATED_REPO_PRIVATE`. Aomi Build does not expose platform names as a directory. Its switcher sends one exact platform name through the signed-in user's source read; the manager returns `404` for an unknown name, and the browser changes context only after a successful response. Existing-repository connection signs the exact platform, `owner/repo`, and an allowlisted Build Projects return URL into GitHub OAuth state; the callback proves repo access, claims the source, and returns success or an actionable error to the scoped Projects page.
- Chat links use `NEXT_PUBLIC_CHAT_URL`, defaulting to `https://aomi.chat`.
- Redeploy requires a Build-side `GITHUB_TOKEN` because it calls GitHub's workflow-run rerun endpoint directly.
