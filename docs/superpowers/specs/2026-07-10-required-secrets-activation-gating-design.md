# Required-secret detection and activation gating

Date: 2026-07-10
Status: **BLOCKED — original approach invalidated by backend verification (2026-07-10).**
See "Verified backend finding" below. The UI/BFF design (sections 2-4) still
holds; the data source (section 1) does not.
Scope: `packages/deploy`, `apps/build`, `apps/portal`, and — newly — `aomi-sdk` CI

## Problem

Aomi SDK apps declare the secrets they need, structurally, at the source level.
The `binance` app is representative:

```rust
const SECRET_API_KEY: Secret = Secret::new(
    "BINANCE_API_KEY",
    "Binance dashboard API key for spot trading...",
    true, // required
);
```

These are registered through the `dyn_aomi_app!` macro's `secrets` parameter.

Aomi Build's Environment tab, however, asks builders to type arbitrary `KEY` /
value pairs with no idea which keys the app actually needs. A builder who
activates the binance app without setting `BINANCE_API_KEY` gets an app that
**activates but never loads** — the failure surfaces late, at runtime, with no
indication of the cause.

The declared-secret data already exists on the backend. `GET /api/thread/apps`
returns it today, and the type is already modelled in this repo:

```ts
// packages/client/src/types.ts:356-363
/** ... so the frontend can render input rows and
 *  gate app load on `required` slots being filled. */
export interface AomiSecretSlot {
  name: string;
  description: string;
  required: boolean;
}
```

The CLI already consumes it (`packages/client/src/cli/commands/control.ts:83`
prints `[requires: BINANCE_API_KEY, BINANCE_SECRET_KEY]`).

The gap: Aomi Build talks to the **deploy/platform** API
(`packages/deploy` → `PlatformApp`), not the chat/session API, and
`PlatformApp` carries no secret slots.

## Goal

Detect an app's required secrets, prompt the builder to fill them **before
activation**, and refuse to activate until every required slot has a value.

## Non-goals

- Reading secret *values* back. The vault is write-only by design; only key
  names are ever returned. Unchanged.
- Validating secret values (e.g. calling Binance to check the key works).
- Distinguishing "environment variable" from "secret" in the backend. That
  split remains cosmetic/entry-time, as shipped.

## Approach

Put the declared slots on the platform-app payload, which is the layer Aomi
Build already reads.

### 1. Data — `packages/deploy`

Add the wire shape to `packages/deploy/src/types.ts`. Declare it locally rather
than importing `AomiSecretSlot` from `packages/client`: this is the backend's
wire shape, both packages parse it independently, and `deploy` must not take a
dependency on `client`.

```ts
export interface SecretSlot {
  name: string;
  description: string;
  required: boolean;
}

export interface PlatformApp {
  // ...existing fields
  secrets?: SecretSlot[];
}
```

Populate it in `camelPlatformApp` (`packages/deploy/src/client.ts:1390`):

```ts
secrets: Array.isArray(a.secrets) ? a.secrets : [],
```

`camelPlatformApp` is the single choke point through which every platform-app
object enters the frontend — `listApps` (`:566`), `getApp` (`:589`),
`listUserSourceAgents` (`:736`), and `camelUserSource`'s `apps` (`:1461`). One
line therefore feeds the project page, the wizard, and the Environment tab.

**Backend dependency (verify first).** `camelPlatformApp` silently drops any
field not in its return literal, so if the backend already emits `secrets` on
`/api/platforms/:platform/apps`, it is being discarded today and this becomes a
pure frontend change. Confirm against a real payload before assuming backend
work. If the field is absent, the backend must add it — additive, on an
existing response, and it is the same fact `/api/thread/apps` already
publishes.

### 2. Computation — a pure helper

Configured key names are already readable via `listAppSecrets` →
`{ byApp: Record<appName, string[]> }` (names only; handles are
`$SECRET:APP:<app>::<KEY>`, stripped to `<KEY>`).

```ts
// packages/deploy/src/secrets.ts (new)
export function missingRequiredSecrets(
  slots: SecretSlot[] | undefined,
  configuredKeys: string[],
): SecretSlot[];
```

Returns the required slots whose `name` is not present in `configuredKeys`.
Optional slots never gate. Exact-match on name (no case folding — env var
names are case-sensitive).

### 3. UI — `apps/build`

Two call sites invoke `launchActivate`, and **both** gate:

- the wizard's `DeployStep` (`features/launch/components/deploy-step.tsx`)
- the project page's `LifecyclePanel`
  (`features/launch/components/deploy-dashboard.tsx`)

Behaviour when an app has unfilled required slots:

- The **Activate** button is disabled, with a short reason
  ("2 required secrets missing").
- The missing slots render as **prefilled rows in the Secrets section** of the
  existing Environment editor: `name` pre-populated and read-only, the SDK's
  `description` as helper text, a masked (`type="password"`) value input.
- Saving goes through the existing `detail.setEnvVars(app, values)` path, then
  refreshes the configured-key list; the gate re-evaluates and Activate enables.

This reuses the Env/Secret split already shipped in `environment-tab.tsx` —
required slots simply become named, explained, mandatory rows rather than
something the builder must know to type.

The Environment tab additionally surfaces a banner listing required-but-missing
slots for the selected app, so the requirement is discoverable outside the
activate flow.

### 4. Backstop — the BFF `activate` route

A client-side gate is bypassable, and the same hole would exist for any other
consumer. `activateLaunchRoute` therefore re-checks server-side, **after** the
existing session + source-ownership + `(app, releaseTag)` pair validation and
**before** `client.activate`:

- The route already holds the owned `source` from `findOwnedSource`, and
  `source.apps` is parsed by `camelPlatformApp` (`client.ts:1461`) — so once
  step 1 lands, the slots are **already in hand**. No extra `listApps` /
  `getApp` call.
- Fetch configured keys once via `listAppSecrets({ githubUserId, sourceId })`.
- Check **only the apps named in the activate request** (`body.apps`), not every
  app on the source.
- If any required slot is unfilled, return **409** with the missing names:

```json
{ "error": "missing required secrets",
  "missing": { "binance": ["BINANCE_API_KEY", "BINANCE_SECRET_KEY"] } }
```

Applied to all **three** copies of the route, so portal and the package BFF
inherit it:

- `apps/build/src/server/launch/routes.ts`
- `apps/portal/src/server/bff/launch/routes.ts`
- `packages/deploy/src/bff/launch-routes.ts`

(The three-way duplication is pre-existing and is why the recent activate
hardening had to land three times. Consolidating it is out of scope here but
worth a follow-up.)

The frontend surfaces the 409's `missing` map in the activate error panel,
rather than a generic failure.

## Data flow

```
GET /api/platforms/:p/apps        -> camelPlatformApp -> PlatformApp.secrets[]
GET /api/build/deployments/secrets  -> listAppSecrets   -> { byApp: string[] }
                                          |
                        missingRequiredSecrets(slots, configuredKeys)
                                          |
                    +---------------------+---------------------+
                    |                                           |
            UI: disable Activate,                   BFF: 409 + missing map
            prefill Secrets rows                    before client.activate
```

## Error handling

- Slots absent (`secrets` undefined or `[]`) → no gate, current behaviour. An
  app that declares nothing must keep activating exactly as it does today.
- `listAppSecrets` fails → surface the error (do **not** fail open and let
  activation through, and do **not** silently render an empty configured list).
- 409 from activate → render the missing slot names inline with a link/scroll to
  the Secrets section, not a generic error toast.
- Values are never echoed back; after save, the UI shows key names only.

## Testing

- **Unit** (`packages/deploy`): `missingRequiredSecrets` — required missing,
  required present, optional missing (no gate), empty/undefined slots,
  case-sensitivity.
- **Unit** (`packages/deploy`): `camelPlatformApp` maps `secrets`, and defaults
  to `[]` when the backend omits it. (This also guards the snake/camel contract
  — a class of bug that recently shipped undetected in `camelOperateAppMetrics`.)
- **Route** (all three copies): activate returns 409 + `missing` when a required
  slot is unfilled; activates normally when filled; unchanged when the app
  declares no slots.
- **Component** (`apps/build`): Activate disabled with an unfilled required
  slot; enabled after saving it; missing slots render with name + description
  and a masked input.

## Verified backend finding (2026-07-10) — invalidates section 1

Traced against `product-mono` (the Rust backend) and `aomi-sdk`:

- `DbApplication` (`crates/database/src/entities/application.rs:11`) has **no**
  secrets column. Its `metadata` Jsonb is written at **activation**
  (`handler/platforms/app_lifecycle.rs:202` → `registered_via: "activate_app"`).
- `GET /api/thread/apps` sources slots from `runtime.catalog_entries()`
  (`handler/app/apps.rs:241`). A catalog entry is only upserted **after the
  runtime `dlopen`s the plugin and reads `aomi_manifest`**
  (`crates/runtime/src/reconstructor.rs:538`). For any app not currently loaded,
  `secrets_for()` returns `unwrap_or_default()` → `[]`.
- The GitHub release asset `manifest.json` is only a checksum index —
  `{app_release_tag, sdk_version, target, commit, plugins: {name: {file, sha256}}}`
  (`aomi-sdk/.github/workflows/release-plugins.yml:86`). **It carries no secrets.**
- There is no `aomi.toml` declaring secrets; `apps/binance` has only
  `Cargo.toml`. Slots exist solely as Rust `Secret::new(...)` consts compiled
  into the plugin `.so`, surfaced through `DynManifest.secrets`.

**Therefore: before activation, the required-secret slots do not exist anywhere
in the system** — not in the DB, not in the runtime catalog, not in the release
assets. Populating `PlatformApp.secrets` from `camelPlatformApp` would correctly
return `[]` for precisely the apps that need gating.

Secondary correction: the app is **not** blocked from loading. `reconstructor.rs`
upserts the catalog entry unconditionally after load; a missing required secret
surfaces later, at vault resolution during a tool call. (`DynManifest.secrets`'
doc comment claims "the host gates app load on every `required: true` slot being
filled" — no such gate exists in the reconstructor. Flag to the backend team.)

## Revised options

**A. Emit the slots from `aomi-build compile` into the release manifest (CHOSEN).**

Resolved 2026-07-10 after investigation: `aomi-build compile` **already**
`dlopen`s every built plugin and reads its full `DynManifest`
(`sdk/bin/build/compile/validate.rs:103` `read_manifest`, called from
`validate_plugin`, invoked unconditionally at `compile/mod.rs:128`). The
`secrets` array is already in memory at build time and simply discarded after
validation. `libloading` is already an SDK dependency.

Cross-compilation is a non-issue: the CI matrix pairs each target with its
native runner (`ubuntu-latest → x86_64-unknown-linux-gnu`,
`macos-latest → aarch64-apple-darwin`), so `dlopen` always succeeds.

So: **have `compile` write `manifest.json` itself**, including per-plugin
`secrets`, replacing the workflow's inline Python step. No host-target second
build, no macro/build-script change. It propagates to every platform repo by
bumping the SDK pin (the release Aomi Build reads is built in the *platform*
repo, not `aomi-sdk`), and it removes an existing fragility: the Python step
registers *every* file in `plugins/` as a plugin (`plugins[path.stem]`, skipping
only `manifest.json`), so any stray file becomes a bogus entry.

Resulting shape:

```json
"plugins": { "binance": { "file": "...", "sha256": "...",
  "secrets": [{ "name": "BINANCE_API_KEY", "description": "...", "required": true }] } }
```

Once that ships, **no backend change is required for the gate**: Aomi Build's BFF
already holds a GitHub token (used today for CI-status enrichment and re-run) and
knows the platform repo + release tag, so it can read the release's
`manifest.json` asset directly and compute the missing set.

**B. Backend extracts and persists at activation-verify time.** (Rejected for now.)
The backend already downloads and verifies release assets; it could read the
manifest and persist slots on the application row, then expose them on the
platform-apps payload. Cleaner long-term, but it still needs the slots to be
extractable, so it depends on A anyway. Worth revisiting once A has shipped.

**C. Post-activation surfacing only.** (Rejected.)
Read slots after the app loads and show "needs configuration" instead of gating.
Does not satisfy "before it activates", and Aomi Build cannot call
`/api/thread/apps` anyway (account-scoped — see the bots decision record).

There is no path that ships purely inside `aomi-widget`. **The unblock is A**, a
small change in `aomi-sdk`; after that the BFF + UI work (sections 2-4) is
self-contained and needs no backend involvement.

## Revised data source (replaces section 1)

`PlatformApp.secrets` is **not** the carrier. Instead:

- `aomi-build compile` writes `secrets` per plugin into the release
  `manifest.json`.
- Aomi Build's BFF fetches that release asset from the platform repo (GitHub
  token + `Platform.repository` + release tag, all already available at the
  activate call site) and returns the slots.
- `missingRequiredSecrets(slots, configuredKeys)` (section 2) is unchanged.
- Sections 3 (UI gate) and 4 (409 backstop) are unchanged.
