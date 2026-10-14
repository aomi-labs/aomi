# @aomi-labs/deploy

TypeScript toolkit for the Aomi platform deploy API, in three cleanly
separated layers:

| Entry                         | Runs in     | What it is                                                                                                                     |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@aomi-labs/deploy`           | server only | `BackendClient` — typed HTTP client holding the activation/service bearer                                                      |
| `@aomi-labs/deploy/bff`       | server only | Helpers for a deploy BFF: error identification, release-manifest secret checks, project ownership, app status mapping           |
| `@aomi-labs/deploy/launch`    | browser     | Typed client for the BFF routes (launch + deployments console), wizard state machine, contracts, OAuth-callback result mapping |
| `@aomi-labs/deploy/lifecycle` | browser     | Pure helpers projecting deploy records into dashboard state                                                                    |

**There is no UI component to install.** The deploy UI is a fast-churn page,
not a stable primitive, so it is not published as a package you vendor — build
the UI your product needs on top of the `@aomi-labs/deploy/launch` client, in
your own stack. Aomi's own portal builds this flow in React against the same
client (`apps/portal/src/features/launch/` in the `aomi-widget` repo) — read it
as a worked example, don't copy it in.

**Integrating from a coding agent?** This package ships an agent-oriented
integration skill at [`skills/aomi-deploy/SKILL.md`](skills/aomi-deploy/SKILL.md).
Point Claude Code / Cursor at it (after `npm install`, it's in
`node_modules/@aomi-labs/deploy/skills/`) to serve the BFF routes, wire the
browser client, and build a bespoke deploy UI without reading the whole README.

## Drop-in one-shot launch (the partner path)

Give your users "deploy an agent" without building any of the flow yourself.
Three steps:

### 1. Serve the BFF routes (server)

The package ships no route handlers. Your server exposes the same-origin routes
the browser client calls (`/api/bff/launch/*`, `/api/bff/auth/github/*`) over a
`BackendClient`, so the activation token never reaches the browser. Aomi's Build
app does this in `apps/build/src/server/bff/deploy/routes.ts`; `./bff` carries
the pieces it shares (`identifyLaunchError`, release-manifest secret checks,
`ownedProject`, `launchAppStatusesResult`).

```ts
// lib/launch.ts (server-only module)
import { BackendClient } from "@aomi-labs/deploy";

export const client = () =>
  new BackendClient({
    aomi: {
      backendUrl: process.env.AOMI_BACKEND_URL!,
      activationToken: process.env.AOMI_ACTIVATION_TOKEN!, // stays server-side
    },
  });
```

### 2. Build the UI (browser, your stack)

Point a `createLaunchClient` at the routes and drive them. The whole happy
path is: `fetchGitHubSession` → `githubAppInstallUrl` → `createRepo` →
`deploy` → `watch` → `activate` → project-scoped `appStatuses` → embed chat. Render it however
your product needs — often just a button, a status line, and a chat embed.

```ts
"use client";
import { createLaunchClient } from "@aomi-labs/deploy/launch";

const launch = createLaunchClient(); // defaults to /api/bff/launch + /api/bff/auth/github
const { deployment, releaseTags, apps } = await launch.deploy({
  projectId,
  sourceRef,
});

await launch.watch({ deploymentId: deployment.id }, (event) => {
  setProgress(event.progress); // { completed, total, label }
});
await launch.activate({ projectId, releaseTags, apps });
```

See the [`aomi-deploy` skill](skills/aomi-deploy/SKILL.md) for the full flow,
and Aomi's portal (`apps/portal/src/features/launch/`) for a worked React
example to read — not vendor.

### 3. Prerequisites from Aomi

- **Backend URL + activation token** for your platform (ask Aomi, or mint via
  the Bootstrap API below).
- **The Aomi GitHub App** does the repo scaffolding and deploy PRs; the OAuth
  client secret stays in the Aomi backend. You don't register anything on
  GitHub.

The flow your users get: Sign in with GitHub → install the Aomi GitHub App →
one-click repo from the template → deploy → CI builds → activate → the live
agent appears in chat.

## Platform-scoped launch (named partner platforms)

Everything above deploys into your host's **default** platform (the first
entry of `APP_DEPLOY_PLATFORMS`). A partner integration usually targets a
specific named platform instead — `"somm.finance"`, not `"community"`. Two
rules make that work:

1. **Every read and write takes an optional `platform`.** Omitted, the BFF
   falls back to its configured default. Named, the request is scoped to that
   exact platform — the Aomi manager answers `404` for a name that doesn't
   exist, and refuses writes against a source that belongs to a different
   platform. Platform names are deliberately **not** enumerated client-side;
   there is no directory to list, you pass the exact name your partner gave
   you.

2. **A deploy target is earned, not asserted.** A source deploys into a
   platform because it was _claimed_ there — created one-click on it, or
   connected through the GitHub OAuth ceremony below. Passing a different
   `platform` string on a later call doesn't move it; the backend rejects the
   mismatch.

**Bind the platform once**, at construction — do not thread it through every
call. Omitting it on a single call falls back to the BFF's _default_ platform,
which is a silent wrong-platform write rather than an error:

```ts
"use client";
import {
  createLaunchClient,
  LaunchRequestError,
} from "@aomi-labs/deploy/launch";

// The exact name your partner gave you.
const launch = createLaunchClient({ platform: "somm.finance" });

// Probe the platform by reading the signed-in user's sources on it.
try {
  const { sources } = await launch.deployments.sources();
} catch (err) {
  if (err instanceof LaunchRequestError && err.status === 404) {
    // No such platform — exact match failed; nothing changed.
  }
  throw err;
}
```

`launch.forPlatform("community")` returns the same client scoped elsewhere, so
switching platforms is one explicit act instead of a parameter you might forget
on one call out of fifteen. Any single call may still pass `platform` to
override. The launch flow sits on the client; the project console lives under
`launch.deployments.*` — two different BFF mounts, so the namespace says which
one you are calling.

`LaunchRequestError` carries `status` and the raw `body` on every non-2xx BFF
response, so "unknown platform" (404), "not yours" (403), and transport
failures stay distinguishable.

### Connecting an existing repository

One-click creates a fresh repo on the user's personal account. A partner
developer usually arrives with an **existing** repository (often under an
org). Connecting it is a GitHub OAuth round trip that proves — with the
_user's_ token, not the App's — that the signed-in GitHub user can actually
read that repo, then claims the source for that user and that exact platform:

```ts
// 1. Start: sign platform + repo + a validated return page into OAuth state.
const url = await launch.githubAppInstallUrl({
  platform: PLATFORM,
  repo: "PeggyJV/somm-agent", // owner/name or a github.com URL — normalized
  returnTo: `${window.location.origin}/projects?platform=${encodeURIComponent(PLATFORM)}`,
});
window.location.assign(url); // full-page nav to GitHub
```

`returnTo` must be a page the Aomi backend recognizes for your deployment
(`AOMI_BUILD_URL` origin, `/projects` or `/operate/deployments/new`, carrying
exactly `?platform=<the signed platform>`). Anything else is rejected before
the state is signed — the callback will never redirect a browser to a URL it
didn't validate.

```ts
// 2. Finish: the callback redirects back to `returnTo` with the outcome in
// the query string. `connectionResult` maps it for rendering — including the
// in-progress statuses that are NOT failures (org-owner approval pending,
// webhook still landing).
import { connectionResult } from "@aomi-labs/deploy/launch";

const result = connectionResult({
  launch: params.launch, // "bound" | "awaiting_install" | …
  repo: params.repo,
  githubError: params.github_error, // capped + sanitized before display
});
// result: { status: "success", repo } | { status: "pending" | "error", message }
```

After a `"bound"` result the repo shows up in `launch.deployments.sources()`
and the normal `preflight → deploy → watch → activate` calls work with no
further platform plumbing.

### Watching a deployment

Do not hand-roll a polling loop. `watch` backs off 3s → 30s, treats a 4xx as
fatal, keeps `completed` monotonic so progress never jumps backwards, and
**never throws** — a failure arrives as an `error` event, so a render loop has
exactly one code path:

```ts
const { deployment } = await launch.deploy({ projectId, sourceRef });

await launch.watch({ deploymentId: deployment.id }, (event) => {
  setProgress(event.progress); // { completed, total, label }
  if (event.kind === "terminal") setState(event.status.state);
  if (event.kind === "error") setError(event.error);
});
```

Cancel with `{ signal }` from an `AbortController` when the component unmounts.

### Platform context helpers

- `platformParam(searchParams.platform)` — normalize `?platform=` off a
  router's searchParams value (trims; repeated params mean "no platform").
- `LaunchState.platform` — the persisted wizard state records which platform
  its progress belongs to. Reset the wizard when the page's platform differs:
  reusing a cached `projectId` from one platform inside another would route
  writes to the wrong place.

```ts
import { loadLaunch } from "@aomi-labs/deploy/launch";

// Scoped load: progress saved under another platform is discarded rather than
// returned, so a stale projectId can never route a write to the wrong place.
const state = loadLaunch(PLATFORM);
```

### Deployments console endpoints

`launch.deployments.*` covers the project-dashboard surface (default mount
`/api/bff/deployments`, override via `deploymentsBasePath`): `sources`,
`status`, `history`, `feed`, `records`, `promote`, `deactivate`, `secrets` /
`setSecrets` / `deleteSecret`, `requiredSecrets`, `upgradeSdk` /
`sdkUpgradeStatus`. All inherit the client's bound platform.

`launch.sdkStatus()` is not duplicated here — both mounts serve it from the
same handler, so there is one method.

## Core API (`@aomi-labs/deploy`)

### `preflight()`

Calls `POST /api/projects/:projectId/deploy` with `preflight: true`. Returns the deployment record
without opening or updating the platform PR. Use this to render
`deployment.json` before the user applies.

### `deploy()`

Calls `POST /api/projects/:projectId/deploy` with an immutable source ref.
This is the apply step: it writes the platform deployment
branch/PR when needed and starts the CI path.

`sourceRef` must be the immutable git commit SHA to deploy. Resolve branches or
tags before calling the client; the backend does not accept mutable refs.

The backend reads the project's committed `.aomi/config.json` itself —
clients never parse or send project configuration.

### `activate()`

Calls `POST /api/platforms/:platform/apps/activate` with one `release_tags`
target. Returns an `ActivateResult` — check `result.ok` and inspect
`result.activation.apps` for per-app errors on partial failure.

### `status()`

Calls `GET /api/platforms/:platform/deployments/:id/status` (pass
`deploymentId`), or `GET /api/platforms/:platform/status` without one. The
status endpoint resolves CI against the **recorded built commit** (not the
live branch HEAD), preventing deployments from being orphaned by snapshot
merges.

### `watchDeployment(deploymentId, platform, onEvent, options?)`

Polls `status()` with exponential backoff (3s → 30s). It does **not** throw:
every tick calls `onEvent(event)` with a `DeploymentProgressEvent` —
`kind: "progress" | "terminal" | "warning" | "error"` — and the loop resolves
after a `terminal` or `error` event. Cancel via `options.signal`.

```ts
await dc.watchDeployment(id, "community", (event) => {
  render(event.progress); // { completed, total, label }
  if (event.kind === "terminal") console.log("done:", event.status.state);
  if (event.kind === "error") console.error(event.error);
});
```

## Bootstrap API

The steps **before** deploy — the twin of the Rust `aomi-build` bootstrap
commands. Each maps 1:1 onto a `/api/platforms/*` route.

| Method                           | Route                                                                          | Purpose                                                               |
| -------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `mintToken()`                    | `POST /:p/tokens`                                                              | mint a `platform` or `app` activation token (plaintext returned once) |
| `listTokens()` / `revokeToken()` | `GET` / `DELETE /:p/tokens[/:id]`                                              | token lifecycle                                                       |
| `createProject()`                | `POST /api/platforms/:p/projects`                                              | resolve an installed repo → `projectId` for deploy                    |
| `scaffold()`                     | `POST /api/integrations/github-app/platforms/:p/projects/create-from-template` | one-shot: create a repo from a template → source                      |
| `listApps()` / `getApp()`        | `GET /:p/apps[/:app]`                                                          | inventory loaded apps (find `app_id` for app-scoped tokens)           |
| `exchangeGitHubCode()`           | `GET /api/integrations/github-app/oauth/exchange`                              | GitHub OAuth code → identity (sign-in seam)                           |
| `listUserProjects()`             | `GET /api/integrations/github-app/user/projects`                               | a GitHub user's connected source repos + their apps                   |

### Credential model

`mintToken()` is privileged: minting the **first** platform token needs an
admin/service AomiBearer, since no activation token exists yet. Configure it as
`aomi.adminBearer` (or pass `bearer` per call). All other calls use
`aomi.activationToken`. This package stays signing-free — mint the bearer with
`AomiService` from `@aomi-labs/account/service-topology` and hand it in.

```ts
import { AomiService } from "@aomi-labs/account/service-topology";
import { BackendClient } from "@aomi-labs/deploy";

// 1. Sign a short-lived admin bearer (holds the EdDSA private key).
const svc = AomiService.fromTopology({
  toml: process.env.AOMI_SERVICE_TOPOLOGY!,
  selfName: "aomi-admin",
  privateKeyPem: process.env.AOMI_ADMIN_KEY!,
});
const { accessToken: adminBearer } = await svc.mint({
  role: "admin",
  subject: "ops-admin",
  audience: "aomi-backend",
});

// 2. Mint a platform activation token with it.
const dc = new BackendClient({
  aomi: { backendUrl: process.env.AOMI_BACKEND_URL!, adminBearer },
});
const { token } = await dc.mintToken({
  platform: "playground",
  scope: "platform",
});

// 3. Resolve the source, then deploy with the minted token.
const client = new BackendClient({
  aomi: { backendUrl: process.env.AOMI_BACKEND_URL!, activationToken: token },
});
const { id } = await client.createProject({
  platform: "playground",
  repo: "alice/alice-bot",
});
await client.deploy({
  projectId: id,
  sourceRef: process.env.AOMI_SOURCE_REF!,
});
```

## Error handling

Every failure is a `DeployError` subclass; branch on `err.code`
(`"BROWSER_ENVIRONMENT" | "INVALID_REQUEST" | "BACKEND" | "ACTIVATION"`).
HTTP failures are `BackendError` (also a `DeployError`) carrying the status
and raw body:

```ts
import { BackendError, DeployError } from "@aomi-labs/deploy";

try {
  await dc.deploy({ ... });
} catch (e) {
  if (e instanceof BackendError) {
    console.error(e.status); // HTTP status (0 when the fetch itself failed)
    console.error(e.body);   // raw response body (string | undefined)
  } else if (e instanceof DeployError) {
    console.error(e.code);   // "INVALID_REQUEST" — rejected before any network call
  }
  console.error(e.message);
}
```

Activation rejections throw `DeployError` with `code: "ACTIVATION"` and the
per-app failures in `err.reason`; a successful call can still contain per-app
errors:

```ts
const result = await dc.activate({ ... });
if (!result.ok) {
  for (const app of result.activation?.apps ?? []) {
    if (app.error) console.error(`${app.name}: ${app.error}`);
  }
}
```

In BFF handlers, `identifyLaunchError(err)` (from `@aomi-labs/deploy/bff`)
maps any of these onto an HTTP status and `{ error }` body.

## Types

The real input/output shapes live in `src/types.ts` and are all exported. The
ones you'll touch first:

```ts
interface DeployInput {
  platform: string;
  projectId: number;
  /** Immutable git commit SHA. Branch names are rejected by the backend. */
  sourceRef: string;
  actor?: string;
}

interface ActivateInput {
  platform: string;
  target: { kind: "release_tags"; value: string[] };
  apps?: string[]; // optional; backend can derive from release tags
  targetTags?: string[];
  actor?: string;
}

interface DeploymentStatus {
  state: "no_ci" | "building" | "releasing" | "ready" | "failed" | "pending";
  deployment?: DeployPayload;
  releaseTags: string[];
  apps?: DeploymentAppStatus[];
  ci?: { status?: string; url?: string; commitHash?: string };
  message?: string;
}
```

## Browser-safe lifecycle helpers

Portal/dashboard UI that only needs to project deploy records into display
state imports the pure helper subpath:

```ts
import {
  deploymentLifecycleFromSource,
  deploymentLifecycleFromStatus,
} from "@aomi-labs/deploy/lifecycle";
```

## Example

```ts
import { BackendClient } from "@aomi-labs/deploy";

const dc = new BackendClient({
  aomi: {
    backendUrl: process.env.AOMI_BACKEND_URL!,
    activationToken: process.env.AOMI_APP_ACTIVATION_TOKEN!,
  },
});

const preview = await dc.preflight({
  projectId: 42,
  sourceRef: process.env.AOMI_SOURCE_REF!,
});
console.log(JSON.stringify(preview.deployment, null, 2));

const { deployment } = await dc.deploy({
  projectId: 42,
  sourceRef: process.env.AOMI_SOURCE_REF!,
});

await dc.activate({
  platform: "community",
  target: {
    kind: "release_tags",
    value: deployment.platform.apps.map((app) => app.releaseTag),
  },
  apps: deployment.platform.apps.map((app) => app.name),
  targetTags: ["staging"],
});
```

## Tests

```
packages/deploy/src/
  activation-request.test.ts   — request construction
  secrets.test.ts              — secret normalization
  backend/*.test.ts            — deploy, activate, sources, bots, secrets, status
  bff/*.test.ts                — error identification and release-manifest secrets
  launch/*.test.ts             — wizard state, redirects, client and progress
```

Run: `npx vitest run packages/deploy/`
