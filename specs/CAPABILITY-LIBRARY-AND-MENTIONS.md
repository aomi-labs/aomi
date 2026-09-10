# Capability Library and Composer Mentions

Status: PROPOSED (2026-09-03)

> **Execution update:** The Library and `@` mention design remains the UI
> foundation, but its Auto/Direct/Coordinate mode model and delivery sequence
> are superseded by
> [`AUTO-DIRECT-EXECUTION-PLAN.md`](./AUTO-DIRECT-EXECUTION-PLAN.md). The current
> proposal exposes only default Auto and explicit single-app Direct.

This proposal replaces the user-facing idea that Basic, Orchestrator, and apps are
peers in one selector. It keeps the existing runtime architecture: a direct turn
runs against one app, while the orchestrator coordinates serial child tasks whose
individual scopes each contain one app, zero or more compatible skills, and one
chain.

It supersedes only the entry-point decision in §1 of
`specs/ORCHESTRATOR-UI-PLAN.md`. The delegation event and Working trace design in
that document remains valid.

## Decision

Use one capability catalog, two related surfaces, and one separate mode control:

1. **Library** — browse, understand, add, connect, and manage Apps and Skills.
2. **`@` picker** — attach Apps, Skills, or Chains to the current turn as typed,
   structured references.
3. **Execution mode** — Auto, Direct, or Coordinate. Modes never appear as catalog
   items.

The default should be **Auto**. It resolves to Direct whenever one execution scope
can satisfy the turn, and to Coordinate only when multiple apps, multiple chains,
or independent scopes require it. The resolved mode is visible before sending.

## Why the current UI feels inconsistent

The current portal implements four separate systems:

- The Packages modal reads and replaces the account app set through
  `/api/account/apps`.
- The composer selector independently reads `/api/thread/apps`, displays every
  authorized descriptor, and stores one app/application ID per thread.
- Skills are available through resource and Pipeline endpoints, but are not
  represented in Portal UI.
- Chain selection is wallet/execution context, outside either catalog.

The package modal and app selector also maintain separate hard-coded maps for
labels, icons, and categories. Installing or removing an app does not invalidate
or constrain the composer selector. Public apps are currently backfilled into the
runtime's available app set, so “installed” is not a runtime availability gate.

The present turn contract accepts only one `app` or `applicationId`; it has no
structured skill, chain, mention, or execution-policy fields. Literal `@labels` in
prompt text would therefore be ambiguous, rename-sensitive, and unsafe to treat as
authority.

## Product ontology

### Mode

How the request is executed.

- **Auto** — choose the cheapest valid execution path and show the resolution.
- **Direct** — fastest path; one app, zero or more compatible skills, and at most
  one execution chain.
- **Coordinate** — slower multi-step path; partitions the request into child task
  scopes that may use different apps, skills, or chains.

“Basic” should disappear. Its actual meaning is Direct with **Aomi Core** as the
default app. “Orchestrator” remains the internal runtime app but is presented to
users as the Coordinate mode.

Direct mode must not be artificially limited to one skill. The engine already
activates multiple compatible skill IDs in one first pass, subject to app-tool
compatibility, chain gates, and aggregate context budget. Product guidance can
recommend one or two skills without inventing a one-skill runtime constraint.

### App

A developer-published executable capability. An app owns tools, authentication,
permissions, supported chains, release/artifact readiness, and optional always-on
instructions. A stable app identity includes application ID or platform as well as
name; name alone is not sufficient.

### Skill

A procedural instruction pack that teaches Aomi how and when to perform a task.
A skill can require existing app tools and can optionally inject tools while it is
active. Most current skills are Aomi-authored, but publisher and trust should be
explicit fields rather than assumptions baked into the type.

### Chain

A per-turn execution scope, not an installable package. A chain mention must never
silently switch the connected wallet network. If execution needs a wallet switch,
that remains an explicit approval step.

### State vocabulary

Do not overload “Installed.” Keep these states independent:

- **Discoverable** — appears in the catalog.
- **Enabled** — included in the account's preferred capability set.
- **Connected** — required account or API authorization exists.
- **Ready** — the host artifact and runtime are available.
- **Compatible** — usable with the current app, chain, and other selections.
- **Active** — attached to this turn.

Use **Add** or **Enable** in the Library unless a real local installation occurs.

## Surface 1: Library

Rename **Packages** to **Library**. Keep the top-right entry point but use a
library/grid glyph and a narrower, calmer responsive sheet rather than a full
marketplace wall.

Primary tabs are **Apps** and **Skills**. “Enabled,” “Connected,” “Public,” and
“Personal” are filters, not peer content types. Chains do not need a Library tab;
they remain execution contexts and appear in the `@` picker.

Search is backed by the same normalized catalog as the composer. Results rank
enabled and recent capabilities first while still allowing discovery.

Clicking a row opens a detail drawer:

| App details                                 | Skill details                                |
| ------------------------------------------- | -------------------------------------------- |
| Publisher, trust, release, readiness        | Publisher, trust, version/source             |
| Supported chains                            | Supported chains and compatible apps         |
| Connection and permissions                  | When to use and instruction summary          |
| Tools grouped as read/write/external effect | **Uses tools** vs **adds tools when active** |
| Add/remove and connect actions              | Enable/favorite and inspect instructions     |

The currently inert installed-app tile buttons are a natural seam for this drawer.

## Surface 2: composer `@` picker

Typing `@` opens one accessible, keyboard-first picker at the caret. It searches
names, aliases, descriptions, tags, publisher, and category as the user types.

The first frontend slice keeps one scrollable result surface—no nested submenu—
and separates results with quiet **Apps**, **Skills**, and **Chains** headings.
Later ranking can add Recommended and Recent sections without changing the
interaction model.

Only capabilities that can become usable may be attached. Selecting a discoverable
but disabled or disconnected app opens its detail/setup flow instead of inserting
an inert token.

Mentions render inline inside the sentence as plain accent-colored references,
not in a separate chip rail above the user's text: `✦ Swap routing`, `▦ Jupiter`,
`◇ Solana`. They are transient turn state, clear after send, and are not parsed
to recover identity from their visible labels. Aomi owns the editor wrapper,
catalog IDs, styling, and keyboard behavior.

### Cardinality and mode behavior

| Selection                  | Direct                     | Coordinate                        |
| -------------------------- | -------------------------- | --------------------------------- |
| No app                     | Defaults to Aomi Core      | Orchestrator chooses child scopes |
| One app                    | Allowed                    | Allowed, usually unnecessary      |
| Multiple apps              | Block and offer Coordinate | Allowed across child tasks        |
| Multiple compatible skills | Allowed within budget      | Allowed and partitioned as needed |
| One chain                  | Allowed                    | Allowed                           |
| Multiple chains            | Block and offer Coordinate | Allowed across child tasks        |

Auto uses the same resolver. It stays Direct for one satisfiable scope and promotes
to Coordinate for multiple apps/chains or incompatible independent work. Explicit
Direct never silently drops a mention or silently changes mode; the send action
shows the conflict and a one-click **Switch to Coordinate** action.

Historical Working traces remain event-derived. Changing the current mode must not
rewrite how past turns are rendered.

## Canonical catalog contract

The Library and `@` picker must consume one discriminated descriptor instead of
joining presentation-only maps in individual components:

```ts
type CapabilitySummary = {
  kind: "app" | "skill" | "chain";
  id: string; // stable, non-display identity
  label: string;
  description?: string;
  publisher?: string;
  icon?: string;
  tags: string[];
  chainRefs: string[];
  availability: {
    discoverable: boolean;
    enabled: boolean;
    connected?: boolean;
    ready: boolean;
  };
  tools?: {
    uses: string[];
    adds: string[];
  };
};
```

App IDs should follow the existing client identity priority:
`application:<id>`, then `platform:<platform>:<name>`, then `name:<name>`.
Skill IDs use registry IDs. Chain IDs should use stable namespace references such
as `eip155:8453`; display labels stay presentation-only.

### Endpoint direction

The account-aware backend resource plane should own the user-facing catalog:

```text
GET /api/resource/capabilities?q=&kinds=app,skill,chain&mode=&limit=
GET /api/resource/capabilities/:kind/:id
POST /api/resource/resolve
```

The existing `/api/resource/skills` is a strong starting point, but hosted app
identity and metadata need to be included before it can be the sole source. The
Pipeline filesystem remains the deterministic operations/build API; it should not
become the account-aware source of truth merely because it exposes `/apps` and
`/skills`.

For an incremental release, a shared frontend catalog provider can normalize the
existing account-app, runtime-app, resource-skill, and chain sources. It must fix
Pipeline pagination (`next`, cursor, and limit), cache once, and invalidate both
account and runtime views after app mutations. This is a bridge, not a permanent
second catalog model.

## Structured turn contract

Extend the start-turn schema rather than embedding routing instructions in text:

```ts
type CapabilityRef =
  | { kind: "app"; id: string }
  | { kind: "skill"; id: string }
  | { kind: "chain"; id: string };

type TurnTarget = {
  policy: "auto" | "direct" | "coordinate";
  refs: CapabilityRef[];
};

type StartTurnIntent = {
  message: string;
  target?: TurnTarget;
  // Legacy app/applicationId remain during migration.
};
```

The server resolves and validates stable references against entitlement, enabled
state, connection, artifact readiness, required tools, chain compatibility, and
mode cardinality. A preflight response or start event should return the exact
resolution and actionable conflicts:

```ts
type ResolvedTarget = {
  mode: "direct" | "coordinate";
  scopes: Array<{
    app: string;
    skills: string[];
    chain?: string;
  }>;
  warnings: string[];
  requiredConnections: string[];
};
```

Direct resolution compiles to the current one-app runtime. Coordinate resolution
feeds the current orchestrator, which emits serial child task requests. The
frontend must not partition flat mentions into child scopes; the server already
owns the compatibility and scheduling rules.

The resolved references should be stamped into turn events for provenance and
replay. The raw label is never authority.

## Tool loading and context cost

Catalog search loads small summaries only. Full tool schemas and skill instructions
remain deferred until resolution/activation. Skills continue to expose required
tools separately from injected tools, and injected namespaces remain hidden until
their owner skill is active. This preserves the current scheduler and avoids
inflating every direct turn with the entire catalog.

## Delivery sequence

### Phase 0 — language and normalization

- Introduce shared capability summaries and stable IDs.
- Define the six state fields above in API and UI copy.
- Rename Packages to Library with Apps and Skills tabs and detail drawers.
- Make both current app surfaces use one normalized provider.
- Repair the baseline AppSelect test mock before using its suite as a migration
  signal.

### Phase 1 — local mentions and modes

- Add an Aomi-owned `CapabilityMentionPicker` around the composer runtime.
- Add structured transient inline mentions and the Auto/Direct/Coordinate pill.
- Enforce cardinality locally for immediate feedback.
- Translate Direct plus one app to the legacy turn fields until the API lands.
- Preserve URL-locked project/app behavior.

### Phase 2 — server resolution

- Extend OpenAPI and regenerate the client.
- Add account-aware catalog detail/search and server-owned resolution.
- Compile Direct targets to one app plus skills and chain.
- Compile Coordinate targets to existing child task scopes.
- Record resolved capabilities on events.

### Phase 3 — catalog maturity

- Move icons, categories, publisher, trust, release, and permission metadata out of
  hard-coded frontend maps.
- Add ranked recommendations and recent/favorite signals.
- Defer tool definitions by selected namespace and measure context savings.
- Consider a public read-only catalog projection separately from the account-aware
  resource plane.

## Acceptance criteria

- Basic and Orchestrator no longer appear among apps.
- Library and composer show the same identity, label, state, and readiness.
- Removing an active app repairs thread state and invalidates all catalog views.
- Direct retains current latency for an untagged Aomi Core turn.
- Multiple compatible skills can run Direct; multiple apps or chains cannot.
- Explicit Direct never silently changes mode or drops a tag.
- Every sent mention is a stable structured reference and every turn records its
  resolved scopes.
- Disabled, disconnected, not-ready, and incompatible are distinct actionable
  states.
- Catalog summaries are searchable without eagerly loading all tool schemas or
  skill instructions.
- Keyboard, screen-reader, IME, and mobile-sheet interactions are covered.

## Measures

Track Auto resolution split, Direct-to-Coordinate conflict rate, mention-to-send
rate, Add-to-first-use conversion, connection failure rate, time to first tool,
total model calls, input context tokens, and success rate by resolved mode. These
metrics determine whether Auto is reducing unnecessary orchestration rather than
merely hiding it.
