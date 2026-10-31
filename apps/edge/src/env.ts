/** The subset of the KV binding the edge uses, so tests need no Workers types. */
export interface EdgeCache {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The subset of a Durable Object namespace the RC replay store uses. */
export interface ReplayStore {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export type EdgeTopologyName = import("@aomi-labs/service-identity").Tier;

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

  // Account surface (sign-in, OAuth server, account graph) on the portal hosts.
  /** Hyperdrive in front of the environment's Postgres; one pool per request. */
  HYPERDRIVE?: { connectionString: string };
  /** Better Auth's session and cookie signing secret (a Wrangler secret, 32+ characters). */
  BETTER_AUTH_SECRET?: string;
  /** The public portal origin Better Auth issues for (cookies, OAuth issuer, SIWE domain). */
  BETTER_AUTH_URL?: string;
  /** Sentry project DSN; unset leaves error reporting off. */
  SENTRY_DSN?: string;
  /** This deployment's version, for diagnostics. */
  CF_VERSION_METADATA?: { id: string };
  // RC-only test identity (rc topology; see api/rc-oidc.ts). All three or the path is off.
  /** Durable Object namespace that remembers used OIDC `jti` values (rc only). */
  RC_OIDC_REPLAY?: ReplayStore;
  /** Canonical account id of the one RC test account the OIDC exchange resolves to. */
  RC_OIDC_ACCOUNT_ID?: string;
  /** Exact GitHub Actions `sub` claim accepted, e.g. repo:aomi-labs/product-mono:environment:rc. */
  RC_OIDC_SUBJECT?: string;
  /** Comma-separated accepted `workflow_ref` values. */
  RC_OIDC_WORKFLOWS?: string;

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

  // Landing surface: the edge is routed on these hosts' /api/* paths.
  /** Comma-separated public Landing hosts (for example aomi.dev). */
  LANDING_HOSTS?: string;
  /** Where the Landing app is reached from the edge. */
  LANDING_UPSTREAM_ORIGIN?: string;

  // Build surface: the edge is routed on these hosts' /api/* and /v1/* paths.
  /** Comma-separated public Build hosts (for example build.aomi.dev). */
  BUILD_HOSTS?: string;
  /** Where the Vercel Build app is reached from the edge (its *.vercel.app alias). */
  BUILD_UPSTREAM_ORIGIN?: string;
  /** Extra origins whose cookie writes Build trusts (its own host is implied). */
  BUILD_TRUSTED_ORIGINS?: string;
  /**
   * HS256 secret of Build's GitHub session cookies (a Wrangler secret, at least
   * 16 characters). Until the Vercel routes are deleted it must equal Build's
   * PORTAL_ONLY_SESSION_SECRET so both sides read the same cookies.
   */
  BUILD_SESSION_SECRET?: string;
  /** OAuth client id for Manager's GitHub App at index 2; defaults to the deployed app for this topology. */
  BUILD_GITHUB_CLIENT_ID?: string;
  /** Default deployment platform when a Build request does not name one. */
  BUILD_DEFAULT_PLATFORM?: string;
  /** Template repository new Build projects are scaffolded from. */
  BUILD_TEMPLATE_REPO?: string;
  /** "true" when scaffolded repositories are created private. */
  BUILD_CREATED_REPO_PRIVATE?: string;
  /** GitHub token the release-manifest secret gate reads with (a Wrangler secret). */
  BUILD_GITHUB_TOKEN?: string;
}
