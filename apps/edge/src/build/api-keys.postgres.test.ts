// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiKeyStore } from "./api-keys";

const baseDatabaseUrl = process.env.AOMI_AUTH_TEST_DATABASE_URL?.trim();
const schemaName = `aomi_api_keys_${randomUUID().replaceAll("-", "")}`;
const describePostgres = isLoopbackPostgres(baseDatabaseUrl) ? describe : describe.skip;
const originalDatabaseUrl = process.env.DATABASE_URL;

// skip-reason: Requires a loopback PostgreSQL database; CI supplies it.
describePostgres("PostgreSQL builder API keys", () => {
  let pool: ReturnType<typeof import("@aomi-labs/account").getPool>;
  let keys: ApiKeyStore;

  beforeAll(async () => {
    const url = new URL(baseDatabaseUrl!);
    url.searchParams.set("options", `-csearch_path=${schemaName}`);
    process.env.DATABASE_URL = url.toString();
    pool = (await import("@aomi-labs/account")).getPool();
    keys = (await import("./api-keys")).postgresKeys(() => pool);
    await pool.query(`create schema "${schemaName}"`);
    // product-mono's supabase/migrations/20261112010000_api_keys.sql.
    await pool.query(
      `CREATE TABLE api_keys (
         id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         key_hash text NOT NULL UNIQUE,
         key_prefix text NOT NULL,
         principal_kind text NOT NULL CHECK (principal_kind IN ('account','builder')),
         principal_id text NOT NULL,
         capabilities text[] NOT NULL,
         label text,
         created_at bigint NOT NULL DEFAULT (EXTRACT(epoch FROM now()))::bigint,
         last_used_at bigint,
         revoked_at bigint
       )`,
    );
  });

  afterAll(async () => {
    try {
      await pool?.query(`drop schema if exists "${schemaName}" cascade`);
    } finally {
      await pool?.end();
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  const row = (hash: string, builderId: string, capabilities: string[] = ["project:deploy"]) => ({
    hash,
    prefix: "aomi_key_abcdefg",
    builderId,
    capabilities,
    label: null,
  });

  it("creates a builder key and finds it by hash", async () => {
    const created = await keys.create({ ...row("hash-a", "4242", ["project:deploy", "project:observe"]), label: "ci" });
    expect(created).toEqual({
      id: expect.any(Number),
      prefix: "aomi_key_abcdefg",
      label: "ci",
      capabilities: ["project:deploy", "project:observe"],
      createdAt: expect.any(Number),
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(Math.abs(created.createdAt - Date.now() / 1000)).toBeLessThan(60);
    expect(await keys.find("hash-a")).toEqual({
      id: created.id,
      builderId: "4242",
      capabilities: ["project:deploy", "project:observe"],
    });
    expect(await keys.find("hash-unknown")).toBeNull();

    await keys.touch(created.id);
    expect((await keys.list("4242"))[0].lastUsedAt).toEqual(expect.any(Number));
  });

  it("lists and revokes by owner", async () => {
    const mine = await keys.create(row("hash-b", "1001"));
    const theirs = await keys.create(row("hash-c", "1002"));
    expect((await keys.list("1001")).map((key) => key.id)).toEqual([mine.id]);

    expect(await keys.revoke("1001", theirs.id)).toBe(false);
    expect(await keys.find("hash-c")).not.toBeNull();

    expect(await keys.revoke("1002", theirs.id)).toBe(true);
    expect(await keys.find("hash-c")).toBeNull();
    const [revoked] = await keys.list("1002");
    expect(revoked.revokedAt).toEqual(expect.any(Number));
    // Revoking again keeps the first timestamp.
    expect(await keys.revoke("1002", theirs.id)).toBe(true);
    expect((await keys.list("1002"))[0].revokedAt).toBe(revoked.revokedAt);
  });

  it("ignores account keys", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into api_keys (key_hash, key_prefix, principal_kind, principal_id, capabilities)
       values ('hash-account', 'aomi_key_account', 'account', '2001', '{}') returning id`,
    );
    expect(await keys.find("hash-account")).toBeNull();
    expect(await keys.list("2001")).toEqual([]);
    expect(await keys.revoke("2001", Number(rows[0].id))).toBe(false);
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
