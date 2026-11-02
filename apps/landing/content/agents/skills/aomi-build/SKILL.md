---
name: aomi-build
description: >
  Use when the user wants to build, scaffold, or update an Aomi app/plugin from
  API docs, OpenAPI or Swagger specs, SDK docs, repository examples, endpoint
  notes, runtime interfaces, or product requirements. Converts specs into Aomi
  SDK crates with `lib.rs`, `client.rs`, and `tool.rs`, plus tool schemas,
  preambles, host-interop flows, and validation steps. Prefer real product
  integrations over docs-only helpers whenever a callable surface exists.
compatibility: "Best when a local `aomi-sdk` checkout is available, often at `../aomi-sdk`. Falls back to bundled references when the SDK repo is not present."
license: MIT
allowed-tools: Bash
metadata:
  author: aomi-labs
  version: "0.1"
---

# Aomi Build

Use this skill for tasks like:

- "Build an Aomi app from this OpenAPI spec."
- "Turn these REST endpoints into an Aomi plugin."
- "Scaffold a new Aomi SDK app for this product/API."
- "Update an existing Aomi app to support these new endpoints."
- "Turn these builder docs or SDK repos into an Aomi assistant."

## First Read

If a local `aomi-sdk` checkout exists, inspect these first:

- `sdk/examples/app-template-http/src/lib.rs`
- `sdk/examples/app-template-http/src/client.rs`
- `sdk/examples/app-template-http/src/tool.rs`
- `docs/repo-structure.md`
- `docs/host-interop.md`
- 2 or 3 relevant apps under `apps/*/src/{lib,client,tool}.rs`

If the supplied docs mostly point to GitHub repositories, SDKs, or examples instead of listing public endpoints:

- treat those linked repositories as the real source of truth
- inspect their README, config examples, example commands, and RPC/API surfaces
- check whether they expose or produce a runnable service interface such as REST, GraphQL, JSON-RPC, gRPC, webhooks, or another stable client contract
- prefer building against that executable surface instead of wrapping the docs themselves
- avoid inventing a public transactional API that the docs do not actually publish

If the current repo is `aomi-widget`, also inspect:

- `apps/landing/content/examples/*.mdx`

If the SDK repo is not available, read:

- [references/aomi-sdk-patterns.md](references/aomi-sdk-patterns.md)
- [references/spec-to-tools.md](references/spec-to-tools.md)

## Default Workflow

1. Identify the product surface:
   - What external API, SDK, repo, or spec is the source of truth?
   - What concrete callable surface exists: REST, GraphQL, JSON-RPC, gRPC, webhook, CLI contract, or something else?
   - Is there a real target we can point the app at: hosted service, self-hosted node, local example stack, or customer-provided endpoint?
   - Is this read-only, execution-oriented, or mixed?
   - What auth/env vars are required?
   - What user state must come from the host or caller?
   - Is this actually a public end-user API, a standard client interface exposed by a runtime/example app, or only builder-facing documentation?
2. Describe the intended user-facing toolset before implementation:
   - list the proposed tools by name
   - say what user intent each tool serves
   - call out which tools are read-only, which prepare actions, and which write or submit
   - mention any expected target URL, runtime, or host dependency
   - if the toolset is uncertain, surface the uncertainty before coding
   - identify the primary user workflow the app should make easy first
   - keep the first pass to the smallest sufficient toolset for that workflow unless the user asked for broader API coverage
3. Reduce the spec into semantically meaningful tools.
4. Scaffold or update the Aomi app using the standard file split:
   - `lib.rs` for manifest and preamble
   - `client.rs` for HTTP client, auth, models, and normalization
   - `tool.rs` for `DynAomiTool` implementations
5. Write the preamble around actual tool behavior, confirmation rules, and any host handoff.
6. Validate with the SDK build flow and add focused tests when logic is non-trivial.

## Tool Design Rules

- First decide what kind of app this should be:
  - product client
  - execution assistant
  - builder / SDK / runtime assistant
- Before implementing, state the proposed toolset in concrete user-facing terms. This is part of the design, not optional polish.
- Prefer the smallest sufficient toolset that makes the primary user workflow work end to end.
- If there are multiple plausible integration targets, briefly state which one you are choosing and why before coding.
- Prefer tools that interact with an actual product surface over tools that merely restate documentation.
- A hosted API is not required. A self-hosted service, local example stack, standard RPC server, or other runnable interface still counts as a real integration target.
- If the source material is SDK- or architecture-heavy, first ask whether it produces a service that clients call. If yes, build the client for that service.
- Only fall back to a builder-oriented or docs-oriented tool surface when no stable executable target is available.
- Do not mirror every endpoint 1:1 unless that is actually the cleanest model-facing API or the user explicitly asked for broad coverage.
- Prefer 3 to 8 tools with clear user intent boundaries such as `search_*`, `get_*`, `build_*`, `submit_*`, `list_*`, or `resolve_*`.
- Prefer intent-shaped tool names over raw protocol or transport names when practical.
- Aggregate noisy upstream endpoints behind a smaller tool surface when the model does not need the raw distinction.
- Prefer typed arguments over raw JSON string blobs when the primary workflow can be modeled cleanly that way.
- Separate core tools from escape hatches. A generic fallback tool such as `*_rpc` or `*_raw` is fine, but it should not replace a clean core workflow.
- Keep args typed and documented with `JsonSchema`. Field doc comments are model-facing and matter.
- Return stable JSON with predictable keys. Normalize upstream naming, paging, and inconsistent shapes inside `client.rs` or helper functions.
- Convert upstream errors into short actionable messages. Do not leak raw HTML, secrets, or giant payload dumps.

## File Responsibilities

### `lib.rs`

- Keep it easy to scan.
- Define `PREAMBLE` or a small `build_preamble()` hook.
- Register tools with `dyn_aomi_app!`.
- Only keep manifest-level wiring here.

### `client.rs`

- Own the app struct, HTTP client, auth headers, env vars, typed models, and response normalization.
- Prefer `reqwest::blocking::Client` with explicit timeouts for sync tools, matching the current SDK examples.
- Keep third-party API quirks here instead of spreading them across tool implementations.

### `tool.rs`

- Implement `DynAomiTool`.
- Use descriptions that tell the model when to call the tool, not just what endpoint it wraps.
- Map normalized client results into concise JSON results.
- Use `DynToolCallCtx` when host state such as connected wallet, session state, or caller attributes is needed.

## Preamble Rules

Write the preamble from the app's real contract:

- Define role, capabilities, workflow, and guardrails.
- Mention tool order for multi-step flows.
- State explicit confirmation requirements before write actions.
- If dates matter, include the current date or instruct the app to use exact dates.
- If the app relies on host wallet/signing tools, say that clearly and do not imply hidden infrastructure.

For deeper patterns and examples, read [references/aomi-sdk-patterns.md](references/aomi-sdk-patterns.md).

## Host Interop And Execution

For execution-oriented apps:

- Follow the public host conventions from `docs/host-interop.md`.
- Do not invent private namespaces or internal fallback behavior.
- When the next step belongs to the host wallet or signer, return machine-readable `SYSTEM_NEXT_ACTION` guidance.
- Preserve exact transaction or signature args when a downstream host tool must execute them.
- Do not claim a write succeeded until the upstream API submit step has actually completed.

## Validation

When working inside `aomi-sdk`:

- Scaffold with `cargo run -p xtask -- new-app <name>` if starting from scratch, or copy `sdk/examples/app-template-http`.
- Build the plugin with `cargo run -p xtask -- build-aomi --app <name>`.
- If `build-aomi` reports zero built plugins for a brand new app, check whether the new `apps/<name>/Cargo.toml` is still untracked. The current xtask prefers `git ls-files` discovery for app manifests.
- For a direct compile signal on an untracked app, use `cargo build --manifest-path apps/<name>/Cargo.toml`.
- If the app has meaningful branching or normalization logic, add unit tests with `aomi_sdk::testing::{TestCtxBuilder, run_tool, run_async_tool}`.
- If a real target is available, validate the app with a short ladder:
  - compile/build
  - connectivity check
  - one representative read flow
  - one representative write or submit flow when applicable
  - post-write verification such as status, receipt, or refreshed state
- Prefer proving one end-to-end user scenario over checking many disconnected endpoints.

When the task also touches docs or demos in `aomi-widget`, update the relevant examples or guides to match the new app behavior.

## Output Expectations

Aim to leave behind:

- a coherent Aomi app crate or patch
- typed tool args and strong descriptions
- a preamble that explains the tool contract and rules
- stable JSON outputs for the host/model
- an app that can point at a real product surface when one exists
- a short validation pass or a clear note about what could not be verified
