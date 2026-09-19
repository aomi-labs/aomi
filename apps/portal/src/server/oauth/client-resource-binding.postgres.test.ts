// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const baseDatabaseUrl = process.env.AOMI_AUTH_TEST_DATABASE_URL?.trim();
const schemaName = `aomi_client_binding_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = baseDatabaseUrl
  ? withSearchPath(baseDatabaseUrl, schemaName)
  : undefined;
const describePostgres = isLoopbackPostgres(baseDatabaseUrl)
  ? describe
  : describe.skip;
const agent = "https://portal.example/v1/agent/mcp";
const pipeline = "https://portal.example/v1/pipeline/mcp";
const originalDatabaseUrl = process.env.DATABASE_URL;

describePostgres("PostgreSQL OAuth client resource binding", () => {
  let pool: ReturnType<typeof import("@aomi-labs/account").getPool>;
  let bind: typeof import("./client-resource-binding").bindAomiPublicClientResource;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const account = await import("@aomi-labs/account");
    const binding = await import("./client-resource-binding");
    pool = account.getPool();
    bind = binding.bindAomiPublicClientResource;
    await pool.query(`create schema "${schemaName}"`);
    await pool.query(
      `create table if not exists ba_oauth_clients (
         id text primary key,
         client_id text not null unique,
         token_endpoint_auth_method text,
         grant_types jsonb
       )`,
    );
    await pool.query(
      `create table if not exists ba_oauth_client_resources (
         id text primary key,
         client_id text not null references ba_oauth_clients (client_id) on delete cascade,
         resource_id text not null,
         metadata jsonb,
         created_at timestamptz,
         unique (client_id, resource_id)
       )`,
    );
  });

  afterAll(async () => {
    try {
      await pool?.query(`drop schema if exists "${schemaName}" cascade`);
    } finally {
      try {
        await pool?.end();
      } finally {
        restoreEnv("DATABASE_URL", originalDatabaseUrl);
      }
    }
  });

  it("locks concurrent first-use requests to one exact resource", async () => {
    const clientId = `codex-${randomUUID()}`;
    await pool.query(
      `insert into ba_oauth_clients
         (id, client_id, token_endpoint_auth_method, grant_types)
       values ($1, $2, 'none', $3::jsonb)`,
      [
        randomUUID(),
        clientId,
        JSON.stringify(["authorization_code", "refresh_token"]),
      ],
    );

    const results = await Promise.all([
      bind({ clientId, resource: agent, db: pool }),
      bind({ clientId, resource: pipeline, db: pool }),
    ]);
    expect(results.sort()).toEqual(["bound", "resource_conflict"].sort());
    const links = await pool.query<{ resource_id: string }>(
      "select resource_id from ba_oauth_client_resources where client_id = $1",
      [clientId],
    );
    expect(links.rows).toHaveLength(1);
    expect([agent, pipeline]).toContain(links.rows[0]?.resource_id);
  });
});

function isLoopbackPostgres(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function withSearchPath(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-csearch_path=${schema}`);
  return url.toString();
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
