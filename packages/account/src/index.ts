// `@aomi-labs/account`: the server side of Aomi sign-in. It finds or creates
// the Aomi account for a Better Auth session, mints the bearers the Rust
// backend accepts, and forwards allow-listed requests to it. Node-only: it
// holds the database pool and the signing key, so never import it in a browser.

export {
  mintAccountBearer,
  mintAgentApiBearer,
  AUDIENCE,
  AGENT_API_AUDIENCE,
  ACCOUNT_BEARER_TTL_SECONDS,
  type MintedBearer,
} from "./bearer";
export { portalService } from "./topology";
export {
  createBackendProxy,
  type ProxyConfig,
  type ProxyFailure,
  type ObserveProxyFailure,
  type AllowedRoute,
  type ResolveCanonicalUserId,
} from "./proxy";
export { getPool } from "./db/pool";

export * from "./types";
