# Domain Rules

The frontend has four responsibilities. `@aomi-labs/client` owns HTTP, SSE,
credentials, `ClientSession`, ordered events, actions, commits and account
transports. `@aomi-labs/react` adapts those contracts to React and assistant-ui.
The widget owns rendering and wallet adapters. Portal, Build, Telegram, embeds
and the CLI compose these layers for their own host.

The authoritative compatibility and security rules are in
[frontend invariants](../docs/topics/development/facts/frontend-invariants.md).
Generated wire types and the public SDK facade remain supported.

## Ownership

| Concern | Owner |
| --- | --- |
| Backend requests and auth renewal | `packages/client/src/client.ts` |
| Ordered conversation, Stop, branching, actions and commits | `packages/client/src/session/` |
| Canonical account graph response and account operations | `packages/client/src/account/` |
| React orchestration and assistant-ui adaptation | `packages/react/src/runtime/` |
| Chat display and wallet adapters | Widget package |
| First-party cookies, widget origin binding, OAuth and upstream authority | `packages/account` and app BFFs |
| Deployment console | `apps/build` |
| Backend orchestration and on-chain execution | Rust backend; never a display cache |

A conversation's thread ID is distinct from an authentication session ID. An
Aomi account ID is distinct from a provider user ID, a token subject, an owner
ID and a signer address. A hosted application ID is distinct from a routing app
name and a package ID. Map these explicitly at each boundary; preserve wire
field names and supported public aliases.

## Requests and events

A composer send enters `ClientSession.sendAsync()`, which submits
`POST /v1/agent/chat`. The session reduces durable event pages in order and
subscribes to `/v1/agent/chat/:id/stream`; polling reconciles gaps and recovery.
Edit and rerun name durable message keys. Stop waits for authoritative,
turn-scoped acknowledgment. Provisional text never advances the durable cursor.

Thread discovery uses `/v1/agent/sessions`. Rename and archive are patches to an
account-owned thread. Every send reads its current transaction safety policy;
a cached display of that policy cannot authorize an action. Wallet approval and
commit completion remain explicit, replay-resistant operations.

Display caches may hold catalogs, profile and credit metadata. They never hold
credentials, conversation events, pending actions or mutation queues. Their
scope includes backend, application and account identity, and a scope change
cancels private work before the new identity can render it.

## Identity and wallets

The first-party browser presents a Better Auth cookie; an embed presents an
origin-bound widget session; the CLI uses its own credential. The BFF resolves
the principal, checks the route's grants and ownership, strips browser cookies
and inbound authorization, and creates the appropriate upstream credential.
An invalid explicit credential never falls back to an ambient cookie. Cookie
writes require the approved origin and CSRF intent. A widget session cannot
obtain a raw internal backend bearer.

The backend receives the canonical Aomi account as its subject. Provider
attestations are verified on the server before embedded wallet identities are
accepted. Wallet adapters supply current capabilities and an explicitly chosen
operating wallet to the session. Embedded AA provisioning is deferred.

Each widget owns its runtime, display cache, wallet state and overlay container.
Changing a wallet SDK must preserve the mounted chat. Public catalogs contain
only an explicit public projection and carry no cookie or installed-app state.

## Hosts and compatibility

Portal hosts chat, auth, OAuth, MCP and its BFF. Build owns deployment UI. Portal
preserves supported deploy APIs and redirects old deployment screens to Build.
The dev wallet seam remains available only outside production because real
auth, signing and account-isolation tests depend on it.

Package and path changes preserve supported consumers during the compatibility
window. Validate immutable baseline consumers against packed candidate packages,
as well as fresh Vite and Next.js installs. Do not rewrite the protected
consumer to accommodate a candidate change. Registry JSON stays frozen during
retirement so existing shadcn clients still receive JSON.
