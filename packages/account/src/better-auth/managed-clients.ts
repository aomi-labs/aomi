import { getPool } from "../db/pool";

export type ManagedOAuthClient = {
  clientId: string;
  clientClass: string | null;
  disabled: boolean;
  redirectUris: readonly string[];
  origins: readonly string[];
  scopes: readonly string[];
  resources: readonly string[];
  dpopBoundAccessTokens: boolean;
};

export async function readManagedOAuthClient(
  clientId: string,
): Promise<ManagedOAuthClient | null> {
  if (!clientId) return null;
  const pool = getPool();
  const [result, links] = await Promise.all([
    pool.query(
      `select client_id, disabled, redirect_uris, scopes, metadata,
              dpop_bound_access_tokens
         from ba_oauth_clients
        where client_id = $1
        limit 1`,
      [clientId],
    ),
    pool.query(
      `select resource_id
         from ba_oauth_client_resources
        where client_id = $1`,
      [clientId],
    ),
  ]);
  return result.rows[0]
    ? managedClient(
        result.rows[0],
        links.rows.map((row) => String(row.resource_id)),
      )
    : null;
}

export async function listManagedWidgetOrigins(): Promise<string[]> {
  const result = await getPool().query(
    `select client_id, disabled, redirect_uris, scopes, metadata,
            dpop_bound_access_tokens
       from ba_oauth_clients
      where coalesce(disabled, false) = false`,
  );
  return Array.from(
    new Set(
      result.rows
        .map((row) => managedClient(row))
        .filter((client) => client.clientClass === "partner_widget")
        .flatMap((client) => client.origins),
    ),
  );
}

function managedClient(
  row: Record<string, unknown>,
  resources: readonly string[] = [],
): ManagedOAuthClient {
  const redirectUris = stringArray(row.redirect_uris);
  const metadata = objectValue(row.metadata);
  return {
    clientId: String(row.client_id),
    clientClass:
      stringValue(metadata.aomi_client_class) ??
      stringValue(metadata.client_class) ??
      null,
    disabled: row.disabled === true,
    redirectUris,
    origins: Array.from(
      new Set(redirectUris.map(normalizedOrigin).filter(Boolean)),
    ) as string[],
    scopes: stringArray(row.scopes),
    resources: [...resources],
    dpopBoundAccessTokens: row.dpop_bound_access_tokens === true,
  };
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizedOrigin(uri: string): string | null {
  try {
    return new URL(uri).origin;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
