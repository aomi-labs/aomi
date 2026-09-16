import { Pool } from "pg";

import budgets from "./pool-budgets.json";

/**
 * The single Postgres pool for this environment's database: BetterAuth's
 * session tables and the canonical account graph (`users` /
 * `auth_providers` / `public_keys`) live side by side, so a user the portal
 * creates is immediately found by the backend connected to the same
 * environment. Staging and production use different databases.
 *
 * Connection string comes from `DATABASE_URL` — the only DB env var in this
 * package. Never hard-code it; it carries the DB password. Node runtime only
 * (not Edge). Lazy: constructed on first use, so importing query/service
 * modules never requires the env (pg also defers connecting until the first
 * query).
 */
let cachedPool: Pool | undefined;

export type AccountPoolOptions = {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
};

type PortalBudget = (typeof budgets)["production"]["portal"];

/** A Supabase project ref: 20 lowercase alphanumerics. */
const PROJECT_REF = /^[a-z0-9]{20}$/;

function supabaseProjectRef(url: URL): string | undefined {
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  if (direct) return direct[1];
  if (!url.hostname.endsWith(".pooler.supabase.com")) return undefined;
  const ref = decodeURIComponent(url.username).split(".").pop() ?? "";
  return PROJECT_REF.test(ref) ? ref : undefined;
}

/**
 * The portal's connection allowance, from the budget product-mono's database
 * crate owns (synced by `pnpm sync:db-pool-budgets`). The environment is chosen
 * by the connection string's project ref, the same way the backend chooses
 * its pools, so the portal can never be sized for the other database. A
 * hosted project with no budget is configuration drift and fails loudly.
 */
export function resolvePortalBudget(connectionString: string): PortalBudget {
  let url: URL | undefined;
  try {
    url = new URL(connectionString);
  } catch {
    url = undefined;
  }
  const ref = url && supabaseProjectRef(url);
  if (!ref) return budgets.production.portal;
  const budget = Object.values(budgets).find(
    (environment) => environment.project_ref === ref,
  );
  if (!budget) {
    throw new Error(
      `Supabase project ${ref} has no entry in pool-budgets.json`,
    );
  }
  return budget.portal;
}

/**
 * Supabase's port 5432 pooler is session mode: every warm Vercel function can
 * consume one of its small fixed client allowance. The budget's transaction
 * pooler port multiplexes those short serverless queries instead. Preserve all
 * credentials and target identity while selecting the serverless-safe mode.
 */
export function resolveAccountConnectionString(
  connectionString: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!env.VERCEL) return connectionString;

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }
  if (
    url.hostname.endsWith(".pooler.supabase.com") &&
    (url.port === "" || url.port === "5432")
  ) {
    url.port = String(resolvePortalBudget(connectionString).pooler_port);
    return url.toString();
  }
  return connectionString;
}

/**
 * Vercel can keep a separate warm function instance for each API route. A
 * transaction pooler is still shared infrastructure, so each instance keeps
 * the budget's per-instance cap with short-lived clients instead of
 * multiplying a larger local pool.
 */
export function resolveAccountPoolOptions(
  env: NodeJS.ProcessEnv = process.env,
  connectionString = "",
): AccountPoolOptions {
  if (!env.VERCEL) {
    return {
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    };
  }
  const portal = resolvePortalBudget(connectionString);
  return {
    max: portal.max_connections_per_instance,
    idleTimeoutMillis: portal.idle_timeout_ms,
    connectionTimeoutMillis: portal.connection_timeout_ms,
  };
}

export function getPool(): Pool {
  if (cachedPool) return cachedPool;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — the account package needs the one shared Postgres URL",
    );
  }
  cachedPool = new Pool({
    connectionString: resolveAccountConnectionString(connectionString),
    application_name: "aomi-portal",
    ...resolveAccountPoolOptions(process.env, connectionString),
  });
  return cachedPool;
}
