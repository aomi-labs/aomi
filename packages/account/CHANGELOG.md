# @aomi-labs/account

## 0.5.0

### Minor Changes

- e008a8d: The edge Worker is the only server that uses this package. `createAuth(env)` builds Better Auth over a per-request pool (`withDatabase`, `currentPool`) and replaces the `auth` singleton; `./principal` reads the request's credentials. Removed: the bearer minting exports (`mintAccountBearer`, `mintDelegatedBearer`, `AUDIENCE`, `ACCOUNT_BEARER_TTL_SECONDS`), `createBackendProxy`, `aomiSiwsClient`, the `./forward`, `./better-auth/client` and `./service-topology` subpaths (use `@aomi-labs/service-identity`), the `e2e` session kind and the `next` peer.
- 186e352: Add `@aomi-labs/account/policy`: the framework-free authorization policy (OAuth resources and scope ceilings, session capabilities and `authorize`). The Better Auth OAuth policy, the portal BFF and the edge Worker now read this one copy.
- 4661a6d: Remove the unused mintAgentApiBearer and AGENT_API_AUDIENCE exports and the obsolete response_transform proxy failure variant.

  Use BACKEND_URL for the server upstream; AOMI_PROXY_BACKEND_URL is no longer read. Landing session aliases and Portal control aliases now return 404; consoles use current thread routes.

  The standalone @aomi-labs/account/backend-url subpath is removed.

- e7d4c1e: Agent wallets: agent keys map to `kind: "agent"` and can't be removed or count as login factors; deactivating an account pauses all its agent wallets. Connections list each connection's lane on its agent wallets (`portal`, `here`, `instant`; a wallet left out has the client's default) and `askOnly`, and name the bot that linked Telegram; deactivating puts every lane back on `portal`. An account merge waits while the other account has a trade in flight or a Telegram link is running. `custody:delegate` is no longer granted, and the Telegram Mini App sign-in helpers are removed. The shared policy (`@aomi-labs/account/policy`) adds the `/v1` resource (one CLI and SDK sign-in accepted on the three REST APIs) and app-locked MCP resources (`/v1/apps/<app>/mcp`, with `resourcePolicy`, `appMcpName`, `appMcpResource` and `acceptsApiToken`), and drops the `custody` and `managed_signing` capabilities.
- Clean cutover of the TypeScript reform. Remove legacy widget exports, subpaths,
  auth props and the SDK wallet option; use signer and curated widget entries.
  Remove CLI command aliases and old state migration. Keep saved OAuth device
  identity and isolate interactive conversation transitions. Build APIs use
  /api/build, with one deployments route family. The Build sandbox signer is
  aomi-build with BUILD_SERVICE_PRIVATE_KEY; Edge remains a separate identity.

### Patch Changes

- 3d17398: Better Auth JWTs (the edge principal token among them) now carry the configured issuer, the OAuth authorization server `<portal origin>/api/auth`, instead of the bare portal origin; the `issuer` option was passed at the wrong nesting level and ignored.
- 0cab445: Linking a login whose parts belong to two other accounts now offers a merge with the strongest owner (the login, then a wallet, then the email) instead of a plain conflict. `IdentityConflictError` carries that owner as `signalOwner`.
- Expose the shared authorization policy and depend on the public service identity package for the Edge cutover, preserving the account-choice fixes in the published 0.3.1 release.
- ee8235a: Move the service topology engine into the workspace package `@aomi-labs/service-identity`.
- bbb78ce: Preserve the configured public wallet-login domain when a staging Portal request reaches its allowed Vercel preview through Edge. Keep direct preview domains and production behavior unchanged; reject unconfigured browser origins and ignore forwarded headers when selecting the wallet domain.
- fe4abed: Raise the staging Supavisor session budget for the temporary RIC1 backend canary.

## 0.2.9

- Reuse shared account client transport and typed HTTP errors while preserving authentication and wallet contracts.
- Keep server session synchronization and origin checks explicit at the BFF boundary.
