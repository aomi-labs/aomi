import type { Pool } from "pg";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { getPool } from "./db/pool";
import { observeAccountInternalFailure } from "./observability";

/** The client IP from the one header the edge overwrites; anything else is caller-controlled. */
export function clientIp(request: Request, header: string | null): string {
  const candidate = header ? (request.headers.get(header)?.trim() ?? "") : "";
  return isIP(candidate) ? candidate : "unknown";
}

// A window starts with the first request for a key and is never extended, so
// steady traffic under the limit keeps getting a fresh budget every window.
const CONSUME = `
INSERT INTO rate_limits (key, count, expires_at)
VALUES ($1, 1, now() + $2 * interval '1 second')
ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN rate_limits.expires_at <= now() THEN 1
    ELSE LEAST(rate_limits.count + 1, $3 + 1) END,
  expires_at = CASE WHEN rate_limits.expires_at <= now()
    THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END
RETURNING count, CEIL(EXTRACT(EPOCH FROM expires_at - now()))::int AS retry_after
`;

const UNDEFINED_TABLE = "42P01";

export function createAccountRateLimitStorage(
  pool: () => Pick<Pool, "query"> = getPool,
) {
  let missingTableReported = false;
  return {
    async consume(
      key: string,
      rule: { window: number; max: number },
    ): Promise<{ allowed: boolean; retryAfter: number | null }> {
      const id = createHash("sha256").update(key).digest("hex");
      let row: { count: number; retry_after: number };
      try {
        const result = await pool().query<{
          count: number;
          retry_after: number;
        }>(CONSUME, [id, rule.window, rule.max]);
        row = result.rows[0];
      } catch (error) {
        // Better Auth limits every sign-in route through this store. A deploy
        // that lands before the table exists must not take sign-in down.
        if ((error as { code?: unknown })?.code !== UNDEFINED_TABLE)
          throw error;
        if (!missingTableReported) {
          missingTableReported = true;
          observeAccountInternalFailure({ kind: "rate_limit_table", error });
        }
        return { allowed: true, retryAfter: null };
      }
      if (Math.random() < 0.02) {
        await pool().query(
          "DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at < now() LIMIT 100)",
        );
      }
      return {
        allowed: row.count <= rule.max,
        retryAfter: row.count <= rule.max ? null : Math.max(1, row.retry_after),
      };
    },
  };
}

export const accountRateLimitStorage = createAccountRateLimitStorage();
