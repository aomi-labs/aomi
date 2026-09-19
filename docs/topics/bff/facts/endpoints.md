---
title: BFF Endpoints
owner: frontend
status: authoritative
area: bff
review_after_days: 30
sources_of_truth:
  - apps/portal/src/app/api
  - apps/portal/src/server/bff/launch/routes.ts
  - apps/portal/src/server/bff/launch/config.ts
---

# BFF Endpoints

The portal BFF routes translate browser-facing portal calls into backend
requests. Public developer routes also live at `/v1/agent/*`,
`/v1/pipeline/*`, `/v1/agent/mcp`, and `/v1/pipeline/mcp`.

The two MCP paths are unversioned OAuth resources and require a valid exact-
resource token even for `initialize` and `tools/list`. `/api/mcp` and
`/api/mcp/direct` were removed without aliases. REST accepts either the exact
resource OAuth grant or a first-party Better Auth session; anonymous/Bearer
sessions are bounded to the guest ceiling and are never tokenless requests.

Every public auth header is stripped before proxying. The portal sends only a
short-lived, operation-downscoped Aomi internal bearer to `api-server`, while
preserving the Gate F app-key, idempotency, payment, response-header, action,
and custody boundaries.

## Endpoint Table

| FE BFF endpoint                  | Who calls it                      | Where it gets to, if any                                                                                                                                      | What it does                                                                                                                                                | Code path                                               |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/bff/launch/projects`   | GitHub-signed-in deploy dashboard | Rust backend `GET /api/integrations/github-app/user/projects?github_user_id[&platform]`                                                                       | Returns the signed-in user's projects across every bound platform. `?platform=` is an explicit narrowing filter, never a default.                           | `apps/portal/src/app/api/bff/launch/projects/route.ts`  |
| `POST /api/bff/launch/create`    | One-click create-project step     | Rust backend `POST /api/integrations/github-app/platforms/:platform/projects/create-from-template`                                                            | Creates a GitHub repo from the configured template and persists the returned project.                                                                       | `apps/portal/src/app/api/bff/launch/create/route.ts`    |
| `POST /api/bff/launch/preflight` | Launch deploy preview step        | Rust backend `POST /api/platforms/:platform/projects` when a repo stands in for a project, then `POST /api/platforms/:platform/deploy` with `preflight: true` | Creates/resolves the project (creation is the only step that takes a platform), then previews the deploy and returns the immutable source commit.           | `apps/portal/src/app/api/bff/launch/preflight/route.ts` |
| `POST /api/bff/launch/deploy`    | Launch deploy step                | Rust backend `POST /api/platforms/:platform/deploy` with `preflight: false`                                                                                   | Applies a deploy for an owned `projectId`, pinned to the exact preflight commit. The platform is derived from the project's binding, never from the caller. | `apps/portal/src/app/api/bff/launch/deploy/route.ts`    |
| `GET /api/bff/launch/status`     | Launch status polling             | Rust backend `GET /api/platforms/:platform/deployments/:deployment/status`                                                                                    | Polls deployment status; the backend resolves CI per poll.                                                                                                  | `apps/portal/src/app/api/bff/launch/status/route.ts`    |
| `POST /api/bff/launch/activate`  | Launch activation step            | Rust backend `POST /api/platforms/:platform/apps/activate`                                                                                                    | Activates release tags for an owned `projectId` on the project's bound platform, after ownership + required-secret gates.                                   | `apps/portal/src/app/api/bff/launch/activate/route.ts`  |
| `GET /api/bff/launch/app`        | Launch live-app status polling    | Rust backend `GET /api/platforms/:platform/apps/:name` with optional `release_tag`                                                                            | Checks whether an owned app is active and loaded, on the owning project's platform.                                                                         | `apps/portal/src/app/api/bff/launch/app/route.ts`       |
| `POST /api/bff/launch/redeploy`  | Project page redeploy action      | Rust backend `GET /api/integrations/github-app/user/projects/:id/latest-deployment`, then backend deployment rerun                                            | Proves ownership, hydrates the project's backend-owned CI run, and asks the backend to rerun it. Returns `409` when no run is available.                    | `apps/portal/src/app/api/bff/launch/redeploy/route.ts`  |

## Operational Notes

- `/api/bff/launch/*` is the current portal launch flow and uses `apps/portal/src/server/bff/launch/routes.ts` for backend authorization and request helpers.
- There is no `/sources` route family and no `app_source_id`: the persisted identity is the Project (`projectId`), and project-scoped reads never accept a caller platform — the backend derives each project's bound platform. See `docs/topics/deploy/facts/projects.md`.
- Onboarding backend calls use the portal's service identity: `aomi-bff` mints a short-lived `service` bearer with `PORTAL_SERVICE_PRIVATE_KEY`. The committed service-topology TOML is selected automatically from the backend target / Vercel environment.
- The portal onboarding BFF does not use `AOMI_ADMIN_SECRET` or `APP_DEPLOY_ACTIVATION_TOKEN`. Activation tokens remain the CLI/update-path credential, not the browser onboarding credential.
- Launch defaults are env-driven server-side config: `APP_DEPLOY_PLATFORMS` (default `community`, JSON array or comma-separated), `APP_DEPLOY_AOMI_TOML_PATHS` (default `aomi.toml`, comma-separated), and optional `APP_DEPLOY_TARGET_TAGS` (comma-separated); the first configured platform is the primary deploy target, while app pickers may merge every configured platform. Aomi Build does not expose those names as a directory. Its switcher sends one exact platform name through the signed-in user's source read; the manager returns `404` for an unknown name, and the browser changes context only after a successful response. Existing-repository connection signs the exact platform, `owner/repo`, and an allowlisted Build Projects return URL into GitHub OAuth state; the callback proves repo access, claims the source, and returns success or an actionable error to the scoped Projects page. The deploy source ref is an immutable commit SHA from `APP_DEPLOY_SOURCE_REF` (or `APP_DEPLOY_SOURCE_COMMIT`).
- Chat links use `NEXT_PUBLIC_CHAT_URL`, defaulting to `https://chat.aomi.dev`.
- Redeploy requires a portal-side `GITHUB_TOKEN` because it calls GitHub's workflow-run rerun endpoint directly.
- Backend-owned Privy auth uses the non-API page route `/auth/privy`; the browser callback posts to the backend callback URL returned by `POST /api/auth/privy/begin`.
