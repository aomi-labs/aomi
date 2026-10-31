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
`/api/mcp/direct` were removed without aliases. REST accepts either the exact
resource OAuth grant or a first-party Better Auth session; anonymous/Bearer
sessions are bounded to the guest ceiling and are never tokenless requests.

Every public auth header is stripped before proxying. The portal sends only a
short-lived, operation-downscoped Aomi internal bearer to `api-server`, while
preserving the Gate F app-key, idempotency, payment, response-header, action,
and custody boundaries.

## Build launch endpoints

| Build BFF endpoint                  | Who calls it                      | Where it gets to, if any                                                                                                                                      | What it does                                                                                                                                                | Code path                                               |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/build/launch/projects`   | GitHub-signed-in deploy dashboard | Rust backend `GET /api/integrations/github-app/user/projects?github_user_id[&platform]`                                                                       | Returns the signed-in user's projects across every bound platform. `?platform=` is an explicit narrowing filter, never a default.                           | `apps/build/src/app/api/build/launch/projects/route.ts`  |
| `POST /api/build/launch/create`    | One-click create-project step     | Rust backend `POST /api/integrations/github-app/platforms/:platform/projects/create-from-template`                                                            | Creates a GitHub repo from the configured template and persists the returned project.                                                                       | `apps/build/src/app/api/build/launch/create/route.ts`    |
| `POST /api/build/launch/preflight` | Launch deploy preview step        | Rust backend `POST /api/platforms/:platform/projects` when a repo stands in for a project, then `POST /api/platforms/:platform/deploy` with `preflight: true` | Creates/resolves the project (creation is the only step that takes a platform), then previews the deploy and returns the immutable source commit.           | `apps/build/src/app/api/build/launch/preflight/route.ts` |
| `POST /api/build/launch/deploy`    | Launch deploy step                | Rust backend `POST /api/platforms/:platform/deploy` with `preflight: false`                                                                                   | Applies a deploy for an owned `projectId`, pinned to the exact preflight commit. The platform is derived from the project's binding, never from the caller. | `apps/build/src/app/api/build/launch/deploy/route.ts`    |
| `GET /api/build/launch/status`     | Launch status polling             | Rust backend `GET /api/platforms/:platform/deployments/:deployment/status`                                                                                    | Polls deployment status; the backend resolves CI per poll.                                                                                                  | `apps/build/src/app/api/build/launch/status/route.ts`    |
| `POST /api/build/launch/activate`  | Launch activation step            | Rust backend `POST /api/platforms/:platform/apps/activate`                                                                                                    | Activates release tags for an owned `projectId` on the project's bound platform, after ownership + required-secret gates.                                   | `apps/build/src/app/api/build/launch/activate/route.ts`  |
| `GET /api/build/launch/apps`       | Launch live-app status polling    | Rust backend `GET /api/platforms/:platform/apps/:name` with optional `release_tag`                                                                            | Checks whether an owned app is active and loaded, on the owning project's platform.                                                                         | `apps/build/src/app/api/build/launch/apps/route.ts`      |
| `POST /api/build/launch/redeploy`  | Project page redeploy action      | Rust backend `GET /api/integrations/github-app/user/projects/:id/latest-deployment`, then backend deployment rerun                                            | Proves ownership, hydrates the project's backend-owned CI run, and asks the backend to rerun it. Returns `409` when no run is available.                    | `apps/build/src/app/api/build/launch/redeploy/route.ts`  |

## Operational Notes

- `/api/build/launch/*` is Build's launch flow, served by the Edge Worker (`apps/edge/src/build/routes.ts`). Build also serves `/api/build/deployments/*` (project console) and `/api/build/launch/{attempts,sdk-status}`.
- There is no `/sources` route family and no `app_source_id`: the persisted identity is the Project (`projectId`), and project-scoped reads never accept a caller platform — the backend derives each project's bound platform. See `docs/topics/deploy/facts/projects.md`.
- Onboarding backend calls use Build's service identity: `aomi-bff` mints a short-lived `service` bearer with `EDGE_SERVICE_PRIVATE_KEY`. The committed service-topology TOML is selected automatically from the backend target / Vercel environment.
- The Build onboarding BFF does not use `AOMI_ADMIN_SECRET` or `APP_DEPLOY_ACTIVATION_TOKEN`. Activation tokens remain the CLI/update-path credential, not the browser onboarding credential.
- Launch defaults are env-driven server-side config read in `apps/edge/src/kernel/config.ts`: `BUILD_DEFAULT_PLATFORM` (default `community`, JSON array or comma-separated; the first is the primary deploy target), `APP_DEPLOY_TEMPLATE_REPO` and `APP_DEPLOY_CREATED_REPO_PRIVATE`. Aomi Build does not expose platform names as a directory. Its switcher sends one exact platform name through the signed-in user's source read; the manager returns `404` for an unknown name, and the browser changes context only after a successful response. Existing-repository connection signs the exact platform, `owner/repo`, and an allowlisted Build Projects return URL into GitHub OAuth state; the callback proves repo access, claims the source, and returns success or an actionable error to the scoped Projects page.
- Chat links use `NEXT_PUBLIC_CHAT_URL`, defaulting to `https://chat.aomi.dev`.
- Redeploy requires a Build-side `GITHUB_TOKEN` because it calls GitHub's workflow-run rerun endpoint directly.
