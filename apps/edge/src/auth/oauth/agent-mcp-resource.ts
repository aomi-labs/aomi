import { getPool } from "@aomi-labs/account";
import {
  aomiOAuthResourcePolicy,
  agentMcpName,
} from "@aomi-labs/account/better-auth";

type Database = {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
};

/** Register an active agent’s canonical MCP resource before issuing grants. */
export async function registerAgentMcpResource(
  resource: string,
  db: Database = getPool(),
): Promise<boolean> {
  const name = agentMcpName(resource);
  const policy = aomiOAuthResourcePolicy(resource);
  if (!name || !policy) return false;
  const agent = await db.query<{ label: string }>(
    `select display_name as label from agents where publisher || '/' || name = $1 and status = 'active' limit 1`,
    [name],
  );
  if (!agent.rows[0]) return false;
  // The agent MCP's policy, exactly as auth.ts seeds the fixed resources.
  await db.query(
    `insert into ba_oauth_resources
       (id, identifier, name, access_token_ttl, allowed_scopes,
        dpop_bound_access_tokens_required, disabled, policy_version,
        created_at, updated_at)
     values ($1, $2, $3, 300, $4::jsonb, $5, false, 1, now(), now())
     on conflict (identifier) do nothing`,
    [
      crypto.randomUUID(),
      resource,
      `${agent.rows[0].label} MCP`,
      JSON.stringify(policy.grantableScopes),
      policy.dpopBoundAccessTokensRequired,
    ],
  );
  return true;
}
