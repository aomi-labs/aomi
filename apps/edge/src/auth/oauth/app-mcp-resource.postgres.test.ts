// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const baseDatabaseUrl = process.env.AOMI_AUTH_TEST_DATABASE_URL?.trim();
const schemaName = `aomi_app_mcp_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = baseDatabaseUrl
  ? withSearchPath(baseDatabaseUrl, schemaName)
  : undefined;
const describePostgres = isLoopbackPostgres(baseDatabaseUrl)
  ? describe
  : describe.skip;
const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
};
const world = "https://portal.example/v1/apps/world/mcp";

describePostgres("PostgreSQL app MCP resource registration", () => {
  let pool: ReturnType<typeof import("@aomi-labs/account").getPool>;
  let register: typeof import("./app-mcp-resource").registerAppMcpResource;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.BETTER_AUTH_URL = "https://portal.example";
    pool = (await import("@aomi-labs/account")).getPool();
    register = (await import("./app-mcp-resource")).registerAppMcpResource;
    await pool.query(`create schema "${schemaName}"`);
    await pool.query(
      `create table applications (
         id bigint primary key, name text not null, label text not null,
         is_active boolean not null default true
       )`,
    );
    await pool.query(
      `create table ba_oauth_resources (
         id text primary key,
         identifier text not null unique,
         name text not null,
         access_token_ttl integer,
         refresh_token_ttl integer,
         signing_algorithm text,
         signing_key_id text,
         allowed_scopes jsonb,
         custom_claims jsonb,
         dpop_bound_access_tokens_required boolean,
         disabled boolean,
         created_at timestamptz,
         updated_at timestamptz,
         policy_version integer,
         metadata jsonb
       )`,
    );
    await pool.query(
      `insert into applications (id, name, label, is_active)
       values (90, 'world', 'World', true), (91, 'gone', 'Gone', false)`,
    );
  });

  afterAll(async () => {
    try {
      await pool?.query(`drop schema if exists "${schemaName}" cascade`);
    } finally {
      try {
        await pool?.end();
      } finally {
        for (const [name, value] of Object.entries(originalEnv))
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
      }
    }
  });

  it("registers an active app's resource once, even under concurrent first use", async () => {
    const results = await Promise.all([
      register(world, pool),
      register(world, pool),
      register(world, pool),
    ]);
    expect(results).toEqual([true, true, true]);
    const rows = await pool.query<{
      name: string;
      allowed_scopes: string[];
      disabled: boolean;
    }>(
      "select name, allowed_scopes, disabled from ba_oauth_resources where identifier = $1",
      [world],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ name: "World MCP", disabled: false });
    expect(rows.rows[0]!.allowed_scopes).toEqual(
      expect.arrayContaining(["mcp:agent", "agent:write", "offline_access"]),
    );
  });

  it("refuses an inactive or unknown app", async () => {
    for (const name of ["gone", "nobody"])
      expect(
        await register(`https://portal.example/v1/apps/${name}/mcp`, pool),
      ).toBe(false);
    const rows = await pool.query(
      "select 1 from ba_oauth_resources where identifier like '%/gone/%' or identifier like '%/nobody/%'",
    );
    expect(rows.rows).toHaveLength(0);
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
