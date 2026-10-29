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
  portal: {
    hosts: ReadonlySet<string>;
    upstream: string | null;
    trustedOrigins: readonly string[];
    catalogPlatforms: readonly string[];
  };
  build: {
    hosts: ReadonlySet<string>;
    upstream: string | null;
    /** Never empty; the first is the default. */
    platforms: readonly string[];
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
    portal: {
      hosts: hosts(env.PORTAL_HOSTS),
      upstream: origin(env.PORTAL_UPSTREAM_ORIGIN),
      trustedOrigins: list(env.PORTAL_TRUSTED_ORIGINS),
      catalogPlatforms: list(env.APP_CATALOG_PLATFORMS),
    },
    build: {
      hosts: hosts(env.BUILD_HOSTS),
      upstream: origin(env.BUILD_UPSTREAM_ORIGIN),
      platforms: platforms.length ? platforms : ["web"],
    },
  };
  parsed.set(env, value);
  return value;
}
