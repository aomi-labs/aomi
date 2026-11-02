import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";

/**
 * The Postgres pool for this environment's database: BetterAuth's session
 * tables and the canonical account graph (`users` / `auth_providers` /
 * `public_keys`) live side by side, so a user the edge creates is immediately
 * found by the backend connected to the same environment.
 *
 * On the edge every request gets its own pool over Hyperdrive
 * ({@link withDatabase}): workerd forbids reusing one request's sockets in
 * another. Outside a request scope (Node tests and scripts) one lazy pool is
 * built from `DATABASE_URL`. Never hard-code the URL; it carries the password.
 */
type Scope = { connectionString: string; pool?: Pool };

const scope = new AsyncLocalStorage<Scope>();
let nodePool: Pool | undefined;

/** Run `fn` with a pool of its own; the pool, if one was opened, closes after it. */
export async function withDatabase<T>(
  connectionString: string,
  fn: () => Promise<T>,
  waitUntil: (closing: Promise<unknown>) => void = () => undefined,
): Promise<T> {
  const current: Scope = { connectionString };
  try {
    return await scope.run(current, fn);
  } finally {
    if (current.pool) waitUntil(current.pool.end().catch(() => undefined));
  }
}

export function getPool(): Pool {
  const current = scope.getStore();
  if (current) {
    current.pool ??= new Pool({
      connectionString: current.connectionString,
      application_name: "aomi-edge",
      max: 5,
    });
    return current.pool;
  }
  if (nodePool) return nodePool;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — the account package needs the one shared Postgres URL",
    );
  }
  nodePool = new Pool({ connectionString, application_name: "aomi-account", max: 4 });
  return nodePool;
}

/**
 * A pool-shaped handle that always reaches the current request's pool, for
 * long-lived holders such as Better Auth's Kysely dialect.
 */
export const currentPool: Pick<Pool, "connect" | "query" | "end"> = {
  connect: () => getPool().connect(),
  query: ((...args: unknown[]) =>
    (getPool().query as (...a: unknown[]) => unknown)(...args)) as Pool["query"],
  end: async () => undefined,
};
