# Build settings: list the platforms a user can deploy to

Date: 2026-08-20
Status: approved, not implemented
Scope: `apps/build` only. No `aomi-labs/product-mono` change.

## Problem

Settings → General → Deployment platform is a blind text box. It asks for an
exact platform name "provided by your partner" and verifies it by attempting a
scoped project read. A developer who belongs to a partner platform has no way to
see which platform they are on, or which others they can reach, without already
knowing the string.

The blindness was deliberate: the only listing endpoint in the manager,
`GET /api/platforms`, is unauthenticated and returns every platform in the
database. Rendering that would publish a directory of Aomi's partners.

## Decision

Derive the list from the projects the signed-in user can already see, rather
than from the global platform directory. "A platform I have access to" means "a
platform I have at least one project on", plus Community, which is always
reachable.

This exposes nothing new. The read is session-scoped and already powers the
projects page; a user learns only the names of platforms whose projects they can
already list.

The typed entry stays as a fallback, because the derivation cannot see a
platform a partner has named but where the user has not connected a project yet.

The shell also gains a standing answer to "which platform am I on". Every scoped
page — Projects, Deployments, Overview — renders against one platform and
nothing on screen said which; the top bar now names it, and clicking it opens
the selector.

## Data flow

Unchanged upstream, all of it already in place:

```
PlatformSwitcher
  → deploymentProjects()                       features/launch/client.ts
    → GET /api/bff/launch/projects             (no `platform` param)
      → userProjectsRoute                      server/bff/launch/routes.ts:1058
        → client.listUserProjects({ githubUserId, platform: undefined })
          → GET /api/integrations/github-app/user/projects?github_user_id=…
            → list_builder_projects            manager project/endpoints.rs:224
```

`list_builder_projects` returns the unfiltered visible-project list when
`platform` is absent, and every project row carries `platform_name`
(`Project::list_json`, manager `project/mod.rs:206`), surfaced to the client as
`UserProject.platformName`.

The BFF passes `platform: undefined` through when the query param is absent
(`routes.ts:1066`), and the browser client omits the param when no platform is
bound (`packages/deploy/src/launch/browser-client.ts:185`). Build's client binds
no platform. So `deploymentProjects()` with no argument is already an
account-wide read.

## Components

### `apps/build/src/features/launch/use-accessible-platforms.ts` (new)

```ts
export type AccessiblePlatform = { name: string; projectCount: number };

export type AccessiblePlatformsState =
  | { status: "loading" }
  | { status: "unavailable" }                       // signed out, or read failed
  | { status: "ready"; platforms: AccessiblePlatform[] };

export function useAccessiblePlatforms(
  activePlatform?: string | null,
): AccessiblePlatformsState;
```

- `useQuery` on `buildQueryKeys.projects(accountKey, undefined)` — the same key
  the projects page uses for its unfiltered list, so the two share one cache
  entry — with `queryFn: () => deploymentProjects()` and
  `staleTime: buildQueryStaleTime.projects`. Enabled only when signed in with a
  resolved account key, matching `useProjects`.
- Derivation: trim each `platformName`, drop empties, count projects per
  distinct name.
- `DEFAULT_DEPLOY_PLATFORM` ("community") is always in the result, at zero
  projects if it has none.
- `activePlatform`, when given, is always in the result, so the panel can never
  mark a platform "Current" that is missing from its own list.
- Order: Community first, then the rest alphabetically. Stable, so the list does
  not reshuffle as counts change.

### `apps/build/src/components/control-plane/platform-switcher.tsx` (changed)

Above the existing form, a list of platform rows: name, project count
("3 projects" / "No projects yet"), and a "Current" marker on the active one.

- Selecting a row switches immediately — `writePlatform(name)` then
  `router.push('/projects?platform=…')` — with **no** verification fetch. The
  name came from an authorized read of the user's own projects; re-verifying it
  would only add latency and a new failure mode. Selecting the current platform
  is a no-op.
- Community is a row in this list and keeps its `HelpBadge` explanation. The
  separate bottom "Community / Use Community" section is removed; it was a
  hardcoded stand-in for the list this spec adds.
- `status: "loading"` renders skeleton rows and leaves the form enabled.
- `status: "unavailable"` renders no list at all, leaving today's exact screen —
  input, Switch button, and the existing "Sign in with GitHub before switching
  platforms." submit guard. A failed list read must never block the fallback
  that does not depend on it.

The form below it is unchanged: same `deploymentProjects(platform)`
verification, same cache priming of `buildQueryKeys.projects(accountKey,
platform)`, same invalidation of the platform being left, same
400/404 → "Platform not found. Nothing changed—check the exact name and try
again." It gets a quieter heading marking it as the path for a platform not in
the list.

### `apps/build/src/components/control-plane/platform-badge.tsx` (new)

A top-bar link reading `Platform <name>`, from `usePlatform()` — the same
URL-then-storage-then-Community resolution the sidebar's platform-scoped links
already use, so the badge cannot disagree with where those links point. It links
to `/settings/general`, the selector.

It takes the left slot of the shell header (`control-plane-shell.tsx`), which
was an empty spacer on desktop, and sits next to the menu button on mobile.

### `apps/build/src/app/(control-plane)/settings/settings-general-panel.tsx` (changed)

Copy replaced. It currently promises the opposite of what the screen will do:

> Enter the platform name provided by your partner. Build checks for an exact
> match without exposing a directory of supported platforms.

New copy states that Build lists the platforms your projects are on, and that a
partner platform you have not connected a project to yet can be entered by exact
name.

## Tests

`components/control-plane/platform-switcher.test.tsx` already mocks
`deploymentProjects`, `next/navigation`, and the GitHub session, and wraps in a
`QueryClientProvider`. Extend it:

- Distinct platforms render from a project list containing duplicates.
- Community renders even when no project is on it.
- The active platform is marked "Current" and is present even with no projects.
- Clicking a row calls `push('/projects?platform=…')` and persists the choice,
  with no additional `deploymentProjects` call beyond the list read.
- A rejected list read leaves the input and Switch button working.
- Existing cases still pass: exact-match switch primes the cache and invalidates
  the old platform; 404 shows "Platform not found".

`features/launch/use-accessible-platforms.test.ts` (new): the derivation —
dedupe, trim, counts, Community injection, active-platform injection, ordering,
and `unavailable` (never an empty list) when the read fails.

`components/control-plane/platform-badge.test.tsx` (new): names the platform the
page is scoped to, falls back to Community, and links to `/settings/general`.

## Out of scope

- Access to a platform where the user has zero projects. Covering that needs a
  real grant model in product-mono (activation tokens or an explicit
  membership table) and a new service-auth endpoint; the typed fallback covers
  the case until then.
- The command palette's platform affordances.
- Any change to `GET /api/platforms`, which stays unused by Build.
