---
"@aomi-labs/account": minor
---

The edge Worker is the only server that uses this package. `createAuth(env)` builds Better Auth over a per-request pool (`withDatabase`, `currentPool`) and replaces the `auth` singleton; `./principal` reads the request's credentials. Removed: the bearer minting exports (`mintAccountBearer`, `mintDelegatedBearer`, `AUDIENCE`, `ACCOUNT_BEARER_TTL_SECONDS`), `createBackendProxy`, `aomiSiwsClient`, the `./forward`, `./better-auth/client` and `./service-topology` subpaths (use `@aomi-labs/service-identity`), the `e2e` session kind and the `next` peer.
