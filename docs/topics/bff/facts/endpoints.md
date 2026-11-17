---
title: BFF Endpoints
owner: frontend
status: authoritative
area: bff
review_after_days: 30
sources_of_truth:
  - apps/edge/src/portal/routes.ts
  - apps/edge/src/auth/routes.ts
  - apps/edge/src/build/routes.ts
  - apps/edge/src/kernel/config.ts
---

# BFF Endpoints

The Edge Worker serves authentication, account and API routes for the Portal
and Build web surfaces. `packages/account/src/policy.ts` defines the Portal
methods, caller requirements and upstreams. Requests carry a short-lived
internal bearer; the Edge strips public credentials before proxying.

`GET /api/thread/catalog` requires an account and thread and returns toolsets
plus account-specific package cards. `GET /api/agents/resolve` uses the explicit
`Aomi-Agent-Key` header and returns one canonical agent card. Public discovery
uses `/api/public/catalog/{models,toolsets,skills}`.

Generic MCP resources are `/v1/agent/mcp` and `/v1/pipeline/mcp`. A hosted agent's
resource is `/v1/agents/<publisher%2Fname>/mcp`. Each MCP transport requires its
own exact OAuth resource grant, including discovery requests.

## Project and channel reads

Build's `/api/build/deployments/projects` lists the caller's projects or reads
one owned `projectId`. `/api/build/deployments/agents` returns the owned
project's agent status. `/api/build/deployments/agent-key` reads or rotates an
owned agent's key. GitHub installation access is read through
`/api/build/deployments/github-app`.

`/api/build/operate/channels` lists, creates, updates or deletes channels.
Each channel has one `agent` object and one `agentId`; there is no primary-agent
selection. Command-secret and webhook checks are scoped to that channel.
The manager derives project ownership from the signed-in GitHub identity.

## Build release endpoints

`apps/edge/src/build/releases.ts` serves the release API on the Build host.
`/api/build/<path>` is the manager's `/api/<path>`, proxied with the raw body
(at most 10 MB, else `413 too_large`). The caller is a builder API key
(`Authorization: Bearer aomi_key_…`), a CLI bearer or the GitHub session
cookie; the manager receives a five-minute `role: "user"` builder bearer
(`principal_class: "builder"`), never the key. A key needs the route's
capability (else `403 insufficient_scope`) and its bearer carries the key's
capabilities; a session's bearer carries all five.

| Route                                            | Manager                                                   | Key capability    |
| ------------------------------------------------ | --------------------------------------------------------- | ----------------- |
| `POST /api/build/packages/:name/releases`        | `POST /api/packages/:name/releases` (`application/x-tar`) | `package:publish` |
| `GET /api/build/packages/:name/releases`         | `GET /api/packages/:name/releases`                        | none              |
| `POST /api/build/packages/:name/promote`         | `POST /api/packages/:name/promote`                        | `package:promote` |
| `POST /api/build/agents/:name/configs`           | `POST /api/agents/:name/configs`                          | `agent:publish`   |
| `GET /api/build/agents/:name/configs`            | `GET /api/agents/:name/configs`                           | none              |
| `POST /api/build/agents/:name/promote`           | `POST /api/agents/:name/promote`                          | `agent:promote`   |
| `GET /api/build/publishers/me`                   | `GET /api/publishers/me`                                  | none              |
| `GET /api/build/agents/:name`                    | `GET /api/agents/:name`                                   | none              |
| `GET /api/build/packages/:name`                  | `GET /api/packages/:name`                                 | none              |
| `PUT /api/build/packages/:name/secrets/:slot`    | `PUT /api/packages/:name/secrets/:slot`                   | `package:secrets` |
| `DELETE /api/build/packages/:name/secrets/:slot` | `DELETE /api/packages/:name/secrets/:slot`                | `package:secrets` |

The request keeps `content-type`, `x-aomi-source-repo` and
`x-aomi-source-commit`; cookies and the caller's `Authorization` are dropped.
