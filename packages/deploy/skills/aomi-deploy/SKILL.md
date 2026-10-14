---
name: aomi-deploy
description: >
  Use when integrating Aomi one-shot agent deploy into a host app or site —
  a partner platform (launchpad, portal, marketplace) that wants users to spin
  up a live Aomi agent and chat with it. Covers the `@aomi-labs/deploy`
  toolkit: serve the server-side BFF routes (helpers in `/bff`), wire the
  browser client (`/launch`), supply credentials, and build a deploy UI in
  your own stack against the typed client. The stable product is the client
  contract, not a UI component — build the UI your product needs.
compatibility: "Host app must have a server that can expose HTTP route handlers (Next.js App Router is the reference; any (Request) => Response server works). Requires an Aomi backend URL + activation token."
license: MIT
allowed-tools: Bash, Read, Edit, Write
metadata:
  author: aomi-labs
  version: "0.1"
---

# Integrate Aomi one-shot deploy

You are wiring **Aomi one-shot agent deploy** into a host app. Outcome: a user
clicks through a short flow and ends with a **live Aomi agent they can chat
with**. This is a thin, self-contained integration — you serve a few server
routes, point a browser client at them, and render a UI.

`@aomi-labs/deploy` is a typed relay to the Aomi platform. It does **not** run
agents or hold business logic; it drives the deploy lifecycle
(scaffold → deploy → CI build → activate → live) over the Aomi backend.

## The one rule: the server/browser boundary

Get this wrong and you leak a bearer token to the browser. Two of the four
entry points are **server-only**:

| Import                        | Runs            | Holds                                                  |
| ----------------------------- | --------------- | ------------------------------------------------------ |
| `@aomi-labs/deploy`           | **server only** | `BackendClient` + the activation bearer                |
| `@aomi-labs/deploy/bff`       | **server only** | helpers for your BFF routes, which hold the bearer     |
| `@aomi-labs/deploy/launch`    | browser         | typed fetch client to your own BFF routes — no secrets |
| `@aomi-labs/deploy/lifecycle` | browser         | pure helpers projecting deploy records into UI state   |

The browser never talks to the Aomi backend directly. It talks to **your**
same-origin BFF routes; those hold the token. Never import `@aomi-labs/deploy`
or `/bff` from a client component.

## Prerequisites (get from Aomi)

- **Backend URL** for your platform, e.g. `https://api.aomi.dev`.
- **Activation token** for your platform (server-side secret). Aomi issues it;
  you never ship it to the browser.
- The **Aomi GitHub App** performs the repo scaffolding and deploy PRs. The
  OAuth client secret lives in the Aomi backend. You register nothing on GitHub.

## Install

```bash
npm install @aomi-labs/deploy      # or pnpm add / yarn add
```

## Step 1 — Serve the BFF routes (server)

`@aomi-labs/deploy` ships no route handlers. Write the same-origin routes the
browser client calls (`/api/bff/launch/*` and `/api/bff/auth/github/*`) in your
server, each a plain `(Request) => Promise<Response>` over a `BackendClient`.
Aomi's Build app is the worked example: `apps/build/src/server/bff/deploy/routes.ts`.

```ts
// server/aomi-deploy.ts  (server-only)
import { BackendClient } from "@aomi-labs/deploy";

export const client = () =>
  new BackendClient({
    aomi: {
      backendUrl: process.env.AOMI_BACKEND_URL!,
      activationToken: process.env.AOMI_ACTIVATION_TOKEN!, // stays here
    },
  });
```

Routes the browser client expects (Next.js App Router paths shown):

```
app/api/bff/launch/{preflight,create,deploy,activate,redeploy}/route.ts   POST
app/api/bff/launch/{status,apps,projects}/route.ts                        GET
app/api/bff/auth/github/{login,callback,status}/route.ts                  GET
app/api/bff/auth/github/signout/route.ts                                  POST
```

`@aomi-labs/deploy/bff` has the shared pieces: `identifyLaunchError` maps a
`DeployError`/`BackendError` to an HTTP status and `{ error }` body,
`fetchReleaseSecretSlots`/`missingSecretsForActivation` check required secrets
before activation, `ownedProject` checks the signed-in user owns a project, and
`launchAppStatusesResult` maps app statuses for the browser. Guard the routes
with per-IP rate limiting and same-origin CSRF checks of your own, and read the
signed-in GitHub user from your own session.

## Step 2 — Wire the browser client

```ts
// client-side
import { createLaunchClient } from "@aomi-labs/deploy/launch";

const launch = createLaunchClient(); // defaults to /api/bff/launch + /api/bff/auth/github
// createLaunchClient({ basePath: "/api/deploy", authBasePath: "/api/gh" }) to relocate
```

`LaunchClient` is the entire browser surface. Methods (all typed):

```
fetchGitHubSession()         → { signedIn, githubLogin, installationId }
githubSigninUrl              → href for a "Sign in with GitHub" link
githubAppInstallUrl({app:2}) → URL to install the Aomi GitHub App
createRepo({installationId, repoName}) → scaffold from the template
preflight(input) / deploy(input)       → dry-run / apply
status({deploymentId})       → one poll: building | releasing | ready | failed
watch({deploymentId}, onEvent)         → poll to completion, backoff, never throws
activate({projectId, releaseTags, apps}) → promote the built release to live
appStatuses({projectId})     → confirm the project's apps are loaded & live
projects()                   → the signed-in user's projects
platform / forPlatform(name) → the bound platform; a client scoped to another
deployments.*                → project console (projects, history, secrets, promote, …)
```

Targeting a named partner platform? Bind it once —
`createLaunchClient({ platform: "somm.finance" })` — the binding applies to
project creation and wizard status polls. Project-scoped calls never send a
platform: the BFF derives each project's bound platform from the project row.

## Step 3 — Build the UI (in your stack)

There is **no UI component to install.** The deploy UI is a fast-churn page,
not a stable primitive — Aomi doesn't ship it as a package you vendor, because
a copied page rots the moment upstream changes and there's no upgrade path.
The stable thing is the `createLaunchClient` contract above; build the UI your
product actually needs on top of it, in whatever framework you use.

The **smallest useful flow** (the entire happy path) is:

1. `fetchGitHubSession()` → if not signed in, link to `githubSigninUrl`.
2. If `installationId` is null, send the user to `githubAppInstallUrl({app:2})`.
3. `createRepo({ installationId, repoName })` → get `projectId` + `sourceRef`.
4. `deploy({ projectId, sourceRef })` → get `deploymentId`.
5. Poll `status(deploymentId)` until `ready` (or `failed`).
6. `activate({ releaseTags, apps })` (both come off the deploy result / status).
7. Poll `appStatuses({ projectId })` until each activated release is live, then embed chat:
   `https://chat.aomi.dev?app=<name>&application_id=<id>&lock_app=1`.

Render it however the host brand wants — a single button, a stepper, a config
form, a conversational intake — because the contract underneath is just those
calls. A launchpad usually wants far less than a full dashboard: often just
"deploy" → status → chat, plus a stop control.

**Want a worked example to read (not vendor)?** Aomi's own portal builds this
exact flow in React against the same client — the deployment feature under
`apps/portal/src/features/launch/` in the `aomi-widget` repo (the one-shot
wizard plus a full operator console: deploy, promote, deactivate, env vars).
Read it for the wiring, then write your own; don't copy it in, or you inherit
Aomi's design stack (Tailwind, `@aomi-labs/react`, the aomi-theme tokens) and a
page you'll have to hand-reconcile on every upstream change.

## Verify it works

- Server routes return JSON, not HTML: `curl -s localhost:3000/api/bff/auth/github/status` → `{"signedIn":false,...}`.
- No secret in the browser bundle: grep your client build for the activation
  token — it must not appear. If it does, you imported `@aomi-labs/deploy` or
  `/bff` from a client component.
- End-to-end: sign in → install → create → deploy → the status poll reaches
  `ready` → activate → the chat embed loads the live agent.

## Constraints & honest gotchas

- **GitHub-identity today.** The current user path assumes the user signs in
  with GitHub and the agent's source repo is created in _their_ GitHub account.
  Fine for a developer-facing portal; heavy for a consumer launchpad. If your
  users shouldn't touch GitHub, you want a **managed-source** deploy (Aomi owns
  the template, users only supply config) — that is a backend arrangement; ask
  Aomi rather than working around it client-side.
- **Immutable source ref.** `deploy` takes a git commit SHA, never a branch.
  `createRepo`/`preflight` resolve it for you; if you deploy by `projectId`
  directly, pass the SHA.
- **Secrets are write-only.** App env-vars/secrets, where supported, return
  key _names_ only — values are never read back.
- **Errors.** BFF routes answer `{ error }` with a faithful HTTP status
  (`identifyLaunchError` maps `DeployError`/`BackendError`). Surface
  `json.error` to the user.
- **Not yet in the browser client:** operator lifecycle (deactivate/"stop",
  promote/rollback, deploy history) exists at the SDK layer but is not exposed
  through `createLaunchClient` yet. If you need a "stop my agent" button, add a
  BFF route over `BackendClient` and a client method — ask Aomi for the
  current shape.

```

```
