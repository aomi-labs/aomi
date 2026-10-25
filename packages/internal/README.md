# @aomi-labs/internal

Typed clients for Aomi's non-core services, server-only and never published.
The edge Worker (`apps/edge`) and the Build BFF call the manager control plane
through this package; it is the only place either may know an internal path.

- `./manager` — `ManagerClient` (the former `@aomi-labs/deploy` `BackendClient`):
  projects, attempts, deployments, releases, secrets, bots, model keys, usage,
  logs, statements, observability. Plus the pure BFF helpers that moved with it
  (`identifyLaunchError`, `missingSecretsForActivation`, `ownedProject`,
  `launchAppStatusesResult`).
- `TimedPromiseCache` — the 15s read-coalescing cache both route ports share.
- `./operate-fixtures` — the Operate example payloads (served only where the
  manager has no data yet), shared by the Build UI, its BFF and the edge.

Wire types, errors and the browser launch client stay in `@aomi-labs/deploy`,
which this package depends on; nothing here is re-exported from it.
