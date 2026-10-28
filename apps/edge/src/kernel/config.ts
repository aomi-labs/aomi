import type { EdgeEnv } from "../env";

/**
 * The Worker's configuration, parsed once per env object. Every optional var
 * may be absent: the Worker must still boot and serve what it can (a missing
 * origin turns its routes into 404s or 502s, never into a crash).
 */
export type Config = {
  /** The backend fleet in BACKEND_ORIGINS order (rendezvous-ranked per request). */
  pool: readonly string[];
  apiServer: string | null;
  payment: string | null;
  /** The manager tunnel; null keeps the control-plane routes on the backend pool. */
  manager: string | null;
  cors: { hostPatterns: readonly string[]; taskPublicOrigins: readonly string[] };
  warmup: { attempts: number; retryMs: number };
  portal: {
    hosts: ReadonlySet<string>;
    upstream: string | null;
    trustedOrigins: readonly string[];
    catalogPlatforms: readonly string[];
    dpopRequired: boolean;
  };
  landing: {
    hosts: ReadonlySet<string>;
    upstream: string | null;
  };
  build: {
    hosts: ReadonlySet<string>;
    upstream: string | null;
    trustedOrigins: readonly string[];
    /** Never empty; the first is the default. */
    platforms: readonly string[];
    templateRepo: string;
    createdRepoPrivate: boolean;
  };
};

export function list(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function flag(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes((value ?? "").trim().toLowerCase());
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function origin(value: string | undefined): string | null {
  return (value ?? "").trim().replace(/\/+$/, "") || null;
}

function hosts(value: string | undefined): Set<string> {
  return new Set(list(value).map((host) => host.toLowerCase()));
}

const parsed = new WeakMap<EdgeEnv, Config>();

export function config(env: EdgeEnv): Config {
  const cached = parsed.get(env);
  if (cached) return cached;
  const platforms = list(env.APP_DEPLOY_PLATFORMS);
  const value: Config = {
    pool: list(env.BACKEND_ORIGINS),
    apiServer: origin(env.API_SERVER_ORIGIN),
    payment: origin(env.PAYMENT_ORIGIN),
    manager: origin(env.MANAGER_ORIGIN),
    cors: {
      hostPatterns: list(env.CORS_ALLOWED_HOST_PATTERNS).map((pattern) => pattern.toLowerCase()),
      taskPublicOrigins: list(env.TASK_CORS_PUBLIC_ORIGINS),
    },
    warmup: {
      attempts: int(env.HOSTED_APP_WARMUP_ATTEMPTS, 1, 1, 10),
      retryMs: int(env.HOSTED_APP_WARMUP_RETRY_MS, 0, 0, 2_000),
    },
    portal: {
      hosts: hosts(env.PORTAL_HOSTS),
      upstream: origin(env.PORTAL_UPSTREAM_ORIGIN),
      trustedOrigins: list(env.PORTAL_TRUSTED_ORIGINS),
      catalogPlatforms: list(env.APP_CATALOG_PLATFORMS),
      dpopRequired: flag(env.AOMI_MCP_DPOP_REQUIRED),
    },
    landing: {
      hosts: hosts(env.LANDING_HOSTS),
      upstream: origin(env.LANDING_UPSTREAM_ORIGIN),
    },
    build: {
      hosts: hosts(env.BUILD_HOSTS),
      upstream: origin(env.BUILD_UPSTREAM_ORIGIN),
      trustedOrigins: list(env.BUILD_TRUSTED_ORIGINS),
      platforms: platforms.length ? platforms : ["web"],
      templateRepo: (env.BUILD_TEMPLATE_REPO ?? "").trim() || "aomi-labs/playground-example",
      createdRepoPrivate: flag(env.BUILD_CREATED_REPO_PRIVATE),
    },
  };
  parsed.set(env, value);
  return value;
}
