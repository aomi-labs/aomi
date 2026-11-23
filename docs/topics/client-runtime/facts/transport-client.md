---
title: Transport Client
owner: sdk
status: authoritative
area: client-runtime
review_after_days: 30
sources_of_truth:
  - packages/client/src/client.ts
  - packages/client/src/session.ts
  - packages/client/src/sse.ts
  - packages/client/src/types.ts
  - packages/client/src/index.ts
---

# Transport Client

`@aomi-labs/client` is the transport and type layer shared by the widget runtime, CLI, and external consumers.

## Main Surface

- `AomiClient` wraps the backend HTTP and SSE APIs behind a single class.
- The client normalizes API URL construction, session headers, API-key headers, and common fetch error handling.
- Shared types for chat, state, threads, system events, simulation, and wallet results live in `packages/client/src/types.ts`.

## Request Families

- Chat and session state methods target `/api/chat`, `/api/state`, `/api/system`, and `/api/interrupt`.
- Session management methods create, list, rename, archive, and delete backend threads.
- Account package methods list the Library, enable or disable packages, and
  manage redacted per-user credential status by canonical package ID.
- SSE support is factored into its own subscriber helper so UI consumers and CLI flows can share the same event model.

## Target and catalog contracts

Public turns select an agent with one `agent` slug (`publisher/name`), plus
`mode: "auto" | "direct"`. Thread-scoped requests use the thread's stored
binding. They do not accept a numeric target query.

`listCatalog(threadId)` reads `/api/thread/catalog` with account and thread
credentials and returns `{ toolsets, packages }`. Package cards carry Library
state for that account. `resolveAgentKey(key)` sends only the explicit
`Aomi-Agent-Key` header to `/api/agents/resolve` and returns one `AgentCard`.
Pipeline discovery and calls name an agent with `?agent=publisher/name` (none
is `aomi/main`): `pipeline.agent(slug?)` lists its core operations, operations
and packages; `.package(id)` narrows to one package and reads its skill files.
A Build is simulated and committed as the agent its `origin.agent` seals.

## Cross-Package Role

- `@aomi-labs/react` depends on this package for runtime transport.
- The `aomi` CLI also depends on this package rather than maintaining a separate backend client.
- This package is the stable boundary when consumers want Aomi backend access without React or widget UI concerns.

## Related Topics

- [client-runtime/facts/react-runtime.md](../../client-runtime/facts/react-runtime.md)
- [client-runtime/facts/cli.md](../../client-runtime/facts/cli.md)
