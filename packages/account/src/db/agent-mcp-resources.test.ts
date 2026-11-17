// @vitest-environment node
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const container = process.env.AOMI_MIGRATION_TEST_CONTAINER;
const migration = readFileSync(
  new URL(
    "./migrations/20261117160000_agent_mcp_resources.sql",
    import.meta.url,
  ),
  "utf8",
);
const suite = container ? describe : describe.skip;

function sql(source: string): string {
  if (container !== "aomi-unified-packages-pgscratch")
    throw new Error("Use the unified-packages local scratch container");
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: source, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
}

function fixture(run: (schema: string) => void) {
  const schema = `fe_oauth_${randomUUID().replaceAll("-", "")}`;
  sql(`create schema ${schema}; set search_path to ${schema};
    create table agents (publisher text, name text);
    insert into agents values ('aomi', 'world');
    create table ba_oauth_resources (
      id text primary key, identifier text unique, name text, access_token_ttl integer,
      refresh_token_ttl integer, signing_algorithm text, signing_key_id text,
      allowed_scopes jsonb, custom_claims jsonb, dpop_bound_access_tokens_required boolean,
      disabled boolean, created_at timestamptz, updated_at timestamptz,
      policy_version integer, metadata jsonb);
    insert into ba_oauth_resources (id, identifier, name, allowed_scopes) values
      ('old', 'https://portal.test/v1/apps/world/mcp', 'World MCP', '["agent:read"]'),
      ('new', 'https://portal.test/v1/agents/aomi%2Fworld/mcp', 'Canonical MCP', '["agent:read"]');
    create table ba_oauth_client_resources (id text primary key, client_id text,
      resource_id text references ba_oauth_resources(identifier), unique(client_id, resource_id));
    insert into ba_oauth_client_resources values
      ('old-link', 'client', 'https://portal.test/v1/apps/world/mcp'),
      ('new-link', 'client', 'https://portal.test/v1/agents/aomi%2Fworld/mcp');
    ${["consents", "access_tokens", "refresh_tokens", "device_codes"]
      .map(
        (table) => `
      create table ba_oauth_${table} (id text primary key, token text, resources jsonb);
      insert into ba_oauth_${table} values ('grant', 'opaque-fixture', '["https://portal.test/v1/apps/world/mcp","https://portal.test/v1/agent/mcp"]'), ('empty', '', '[]'), ('null', '', null);`,
      )
      .join("")}
  `);
  try {
    run(schema);
  } finally {
    sql(`drop schema ${schema} cascade;`);
  }
}

suite("hosted MCP resource migration", () => {
  it("preserves grants and opaque tokens, resolves duplicate links, and is idempotent", () => {
    fixture((schema) => {
      sql(`set search_path to ${schema}; ${migration}`);
      sql(`set search_path to ${schema}; ${migration}`);
      const rows = sql(`set search_path to ${schema};
        select count(*) from ba_oauth_resources where identifier like '%/v1/apps/%';
        select count(*) from ba_oauth_client_resources;
        select name from ba_oauth_resources;
        ${["consents", "access_tokens", "refresh_tokens", "device_codes"].map((table) => `select token || ':' || resources::text from ba_oauth_${table} where id = 'grant';`).join("")}
      `);
      expect(rows).toContain("0\n1\nCanonical MCP\n");
      expect(rows.match(/opaque-fixture:/g)).toHaveLength(4);
      expect(rows).toContain(
        '"https://portal.test/v1/agents/aomi%2Fworld/mcp", "https://portal.test/v1/agent/mcp"',
      );
    });
  });
  it("refuses ambiguous old names without moving their grants", () => {
    fixture((schema) => {
      sql(
        `set search_path to ${schema}; insert into agents values ('bob', 'world');`,
      );
      expect(() => sql(`set search_path to ${schema}; ${migration}`)).toThrow();
      expect(
        sql(
          `set search_path to ${schema}; select count(*) from ba_oauth_client_resources where resource_id = 'https://portal.test/v1/apps/world/mcp';`,
        ),
      ).toContain("1\n");
    });
  });
});
