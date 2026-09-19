// `@aomi-labs/account` — server-only BFF seam for every Aomi frontend (portal,
// base, landing). Resolve-or-create the canonical user against the database the
// Rust backend reads (BetterAuth session → `./account`'s
// `getOrCreateAomiUserForBetterAuthSession`), mint the AccountBearer that
// carries `sub` = that canonical id, and provide the shared session cookie +
// backend proxy + auth-exchange route every BFF mounts. Node-only (holds `pg` +
// the EdDSA private key) — never import into a browser/client bundle. See
// docs/topics/account-authentication/facts/service-identity.md.

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
export { createBearerTokenRoute } from "./token";
export { getPool } from "./db/pool";

// Account auth types folded in from the former `@aomi-labs/auth` root export.
export * from "./types";
