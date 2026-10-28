import "server-only";

import { randomUUID } from "node:crypto";
import { getPool } from "@aomi-labs/account";
import {
  aomiOAuthResourcePolicy,
  appMcpName,
} from "@aomi-labs/account/better-auth";

type Database = {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
};

/**
 * Register an app-locked MCP resource (`<portal>/v1/apps/<app>/mcp`) the first
 * time a client asks for it. Better Auth only issues tokens for resources in
 * `ba_oauth_resources`, and apps come and go, so these are not seeded at boot.
 * The app must be active, as api-server's `DbApplication::is_active` checks
 * (name + `is_active`; private apps are left to api-server's access check).
 * Concurrent first uses converge on one row. False: not an app MCP resource,
 * or no active app has that name, so the request keeps `invalid_target`.
 */
export async function registerAppMcpResource(
  resource: string,
  db: Database = getPool(),
): Promise<boolean> {
  const name = appMcpName(resource);
  const policy = aomiOAuthResourcePolicy(resource);
  if (!name || !policy) return false;
  const app = await db.query<{ label: string }>(
    `select label from applications where name = $1 and is_active limit 1`,
    [name],
  );
  if (!app.rows[0]) return false;
  // The agent MCP's policy, exactly as auth.ts seeds the fixed resources.
  await db.query(
    `insert into ba_oauth_resources
       (id, identifier, name, access_token_ttl, allowed_scopes,
        dpop_bound_access_tokens_required, disabled, policy_version,
        created_at, updated_at)
     values ($1, $2, $3, 300, $4::jsonb, $5, false, 1, now(), now())
     on conflict (identifier) do nothing`,
    [
      randomUUID(),
      resource,
      `${app.rows[0].label} MCP`,
      JSON.stringify(policy.grantableScopes),
      policy.dpopBoundAccessTokensRequired,
    ],
  );
  return true;
}
