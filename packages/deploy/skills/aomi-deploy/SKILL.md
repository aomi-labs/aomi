---
name: aomi-deploy
description: Integrate numbered package releases and agent configuration through Manager.
---

# Package and agent releases

Keep Manager credentials on the server. Use `@aomi-labs/internal` to read the
publisher, package releases and agent configuration; relay only the required
browser views through an authenticated BFF. The Build implementation lives in
`apps/build/src/features/packages` and `apps/edge/src/build/releases.ts`.

A package is an immutable WASI component with numbered releases. Publish a
component with its manifest, fill declared builder secret slots with
`setPackageSecret`, then promote the release. Agent configuration names the
packages it runs; publish and promote its numbered configuration separately.
A channel selects exactly one agent. Chat links use
`?agent=<publisher/name>&lock_agent=1`; MCP resources percent-encode the slash
in `/v1/agents/<publisher%2Fname>/mcp`.
