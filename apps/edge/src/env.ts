/** The subset of the KV binding the edge uses, so tests need no Workers types. */
export interface EdgeCache {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

export type EdgeTopologyName = "default" | "staging" | "production";

/**
 * Worker bindings. Origins are injected at deploy time (see scripts/deploy.mjs);
 * everything else is a Wrangler var or secret.
 */
export interface EdgeEnv {
  /** Comma-separated backend fleet, in rollout order. */
  BACKEND_ORIGINS?: string;
  /** The API Server origin; only its admitted public routes are exposed. */
  API_SERVER_ORIGIN?: string;
  /** The payment service origin; only exact public routes are exposed. */
  PAYMENT_ORIGIN?: string;
  /** Manager cutover switch: set to move the control-plane routes off the backend pool. */
  MANAGER_ORIGIN?: string;
  CORS_ALLOWED_HOST_PATTERNS?: string;
  /** Exact browser origins allowed to read Task challenges without credentials. */
  TASK_CORS_PUBLIC_ORIGINS?: string;
  HOSTED_APP_WARMUP_ATTEMPTS?: string;
  HOSTED_APP_WARMUP_RETRY_MS?: string;
  /** KV namespace for the Task discovery challenge and other short-lived caches. */
  EDGE_CACHE?: EdgeCache;
  /** Which committed topology the edge mints as; defaults from the request host. */
  EDGE_TOPOLOGY?: EdgeTopologyName;
  /** PKCS#8 PEM of the `aomi-edge` signing key (a Wrangler secret). */
  EDGE_SERVICE_PRIVATE_KEY?: string;

  // Portal surface: the edge is routed on these hosts' /api/* and /v1/* paths.
  /** Comma-separated public portal hosts (for example chat.aomi.dev). */
  PORTAL_HOSTS?: string;
  /** Where the Vercel portal is reached from the edge (its *.vercel.app alias). */
  PORTAL_UPSTREAM_ORIGIN?: string;
  /** Extra origins whose cookie reads and writes the portal trusts (its own host is implied). */
  PORTAL_TRUSTED_ORIGINS?: string;
  /** Platforms /api/thread/apps is filtered to when the caller names none. */
  APP_CATALOG_PLATFORMS?: string;
  /** "true" when MCP resources require DPoP-bound access tokens. */
  AOMI_MCP_DPOP_REQUIRED?: string;
}
