import { randomUUID } from "node:crypto";
import { getPool } from "../db/pool";
import {
  aomiOAuthResourcePolicy,
  acceptsAomiApiToken,
  aomiOAuthResources,
} from "./oauth-policy";

type QueryResult<Row> = { rows: Row[] };

type BindingClient = {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  release(): void;
};

export type ClientResourceBindingDatabase = {
  connect(): Promise<BindingClient>;
};

export type ClientResourceBindingResult =
  | "bound"
  | "already_bound"
  | "client_not_found"
  | "client_not_eligible"
  | "resource_conflict";

const AUTHORIZATION_CODE_GRANTS = new Set([
  "authorization_code",
  "refresh_token",
]);
const DEVICE_CODE_GRANTS = new Set([
  "urn:ietf:params:oauth:grant-type:device_code",
  "refresh_token",
]);

/**
 * Bind public clients to admitted resources, transactionally.
 *
 * RFC 7591 does not define registration-time `resources`, and Codex omits that
 * extension. The first authorize request is therefore the earliest request
 * that identifies which MCP server the client is for. Locking the client row
 * makes that first-use binding deterministic across concurrent instances. Any
 * later DCR attempt to use another resource fails closed. CIMD identities may
 * link separate MCP resources; every authorization and token grant still carries
 * one exact resource, enforced by the request policy and OAuth provider.
 */
export async function bindAomiPublicClientResource(input: {
  clientId: string;
  resource: string;
  db?: ClientResourceBindingDatabase;
}): Promise<ClientResourceBindingResult> {
  const db = input.db ?? (getPool() as ClientResourceBindingDatabase);
  const client = await db.connect();
  try {
    await client.query("begin");
    const registered = await client.query<{
      token_endpoint_auth_method: unknown;
      grant_types: unknown;
      client_class: unknown;
      client_discovery_id: unknown;
    }>(
      `select token_endpoint_auth_method, grant_types, client_discovery_id,
              coalesce(metadata->>'aomi_client_class', metadata->>'client_class') as client_class
         from ba_oauth_clients
        where client_id = $1
        for update`,
      [input.clientId],
    );
    const row = registered.rows[0];
    if (!row) {
      await client.query("rollback");
      return "client_not_found";
    }
    const grants = stringArray(row.grant_types);
    if (
      row.token_endpoint_auth_method !== "none" ||
      (!exactSet(grants, AUTHORIZATION_CODE_GRANTS) &&
        !exactSet(grants, DEVICE_CODE_GRANTS))
    ) {
      await client.query("rollback");
      return "client_not_eligible";
    }

    // A metadata document identifies one client across resource servers. Bind
    // each grant's audience exactly, without pinning that client's identity to
    // the first MCP it used. DCR and managed-widget clients keep their policy.
    const metadataClient = row.client_discovery_id === "cimd";
    if (
      metadataClient &&
      (!input.resource.endsWith("/mcp") ||
        !aomiOAuthResourcePolicy(input.resource))
    ) {
      await client.query("rollback");
      return "resource_conflict";
    }

    const links = await client.query<{ resource_id: unknown }>(
      `select resource_id
         from ba_oauth_client_resources
        where client_id = $1
        for update`,
      [input.clientId],
    );
    const resources = Array.from(
      new Set(links.rows.map((link) => String(link.resource_id))),
    );
    // Managed widgets may use only their operator-registered resources.
    // Never apply first-use binding or add a resource for these clients.
    // `/v1` (the one browser sign-in) stands for the REST APIs, so a widget
    // registered for one of them may use it; its scopes still bound the token.
    if (row.client_class === "partner_widget") {
      const allowed =
        resources.includes(input.resource) ||
        (input.resource === aomiOAuthResources().apiRest &&
          resources.some((resource) => acceptsAomiApiToken(resource)));
      await client.query(allowed ? "commit" : "rollback");
      return allowed ? "already_bound" : "resource_conflict";
    }
    if (
      (metadataClient || resources.length === 1) &&
      resources.includes(input.resource)
    ) {
      await client.query("commit");
      return "already_bound";
    }
    if (resources.length > 0 && !metadataClient) {
      await client.query("rollback");
      return "resource_conflict";
    }

    await client.query(
      `insert into ba_oauth_client_resources
         (id, client_id, resource_id, metadata, created_at)
       values ($1, $2, $3, null, now())`,
      [randomUUID(), input.clientId, input.resource],
    );
    await client.query("commit");
    return "bound";
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function exactSet(actual: string[], expected: ReadonlySet<string>): boolean {
  return (
    actual.length === expected.size &&
    new Set(actual).size === actual.length &&
    actual.every((entry) => expected.has(entry))
  );
}
