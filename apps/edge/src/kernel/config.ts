import { z } from "zod";

import type { EdgeEnv } from "../env";
import { EdgeError } from "./errors";

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
    /** Fallback when a request does not name a platform. */
    defaultPlatform: string;
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
      defaultPlatform: env.BUILD_DEFAULT_PLATFORM?.trim() || "web",
      templateRepo: (env.BUILD_TEMPLATE_REPO ?? "").trim() || "aomi-labs/playground-example",
      createdRepoPrivate: flag(env.BUILD_CREATED_REPO_PRIVATE),
    },
  };
  parsed.set(env, value);
  return value;
}

/** What the account surface needs bound: the database, and Better Auth's issuer and secret. */
const AUTH_BINDINGS = z.object({
  HYPERDRIVE: z.object({ connectionString: z.string().min(1) }),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
});

const checked = new WeakSet<EdgeEnv>();

/**
 * Fail closed when the account surface is misconfigured, before Better Auth
 * starts. Local Node suites (NODE_ENV development or test) bring their own
 * database URL and Better Auth's development secret.
 */
export function assertAuthBindings(env: EdgeEnv): void {
  if (checked.has(env)) return;
  const local = ["development", "test"].includes((env as { NODE_ENV?: string }).NODE_ENV ?? "");
  const result = AUTH_BINDINGS.safeParse(env);
  if (!local && !result.success) {
    const missing = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new EdgeError(503, "auth_unconfigured", { cause: new Error(`invalid bindings: ${missing}`) });
  }
  checked.add(env);
}
