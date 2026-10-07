// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mergeAccountRows, previewAccountMerge } from "./queries";

const connectionString = process.env.AOMI_AUTH_TEST_DATABASE_URL;
const enabled = Boolean(
  connectionString && process.env.AOMI_TEST_DATABASE_DISPOSABLE === "1",
);
const databaseName = `aomi_auth_loopback_test_merge_${randomUUID().replaceAll("-", "")}`;
const fixtureUrl = new URL(
  "../../../../tests/fixtures/account-merge/",
  import.meta.url,
);

// skip-reason: Requires the explicitly marked disposable PostgreSQL fixture; CI provides it.
describe.skipIf(!enabled)("merge_accounts", () => {
  let admin: Pool;
  let pool: Pool;
  let db: PoolClient;
  let databaseCreated = false;

  beforeAll(async () => {
    // The migration scans public, so a schema cannot isolate it from parallel suites.
    admin = new Pool({ connectionString });
    await admin.query(`create database "${databaseName}"`);
    databaseCreated = true;
    const databaseUrl = new URL(connectionString!);
    databaseUrl.pathname = `/${databaseName}`;
    pool = new Pool({ connectionString: databaseUrl.toString() });
    db = await pool.connect();
    await db.query("begin");
    await db.query(
      readFileSync(
        new URL("../../e2e/fixtures/canonical-account-schema.sql", fixtureUrl),
        "utf8",
      ),
    );
    await db.query(readFileSync(new URL("schema.sql", fixtureUrl), "utf8"));
    await db.query(
      readFileSync(
        new URL("20261007000000_account_merge.sql", fixtureUrl),
        "utf8",
      ),
    );
  });

  afterAll(async () => {
    await db?.query("rollback");
    db?.release();
    await pool?.end();
    if (databaseCreated) await admin.query(`drop database "${databaseName}"`);
    await admin?.end();
  });

  it("moves everything to the target, keeps its clashing key and closes the source", async () => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const target = `merge-target-${suffix}`;
    const source = `merge-source-${suffix}`;
    const address = `0x${suffix.padStart(40, "0")}`;
    await db.query(
      `insert into users (id, username) values ($1, $1), ($2, $2)`,
      [target, source],
    );
    await db.query(
      `insert into threads (id, user_id) values ($1, $2), ($3, $4), ($5, $4)`,
      [`t1-${suffix}`, target, `t2-${suffix}`, source, `t3-${suffix}`],
    );
    const identity = await db.query(
      `insert into auth_providers
         (user_id, provider, method, value, created_at, updated_at,
          issuer_environment, tenant_id, subject)
       values ($1, 'siwe', 'siwe', $2, 1, 1, 'eip155', 'global', $2)
       returning id`,
      [source, `eip155:*:${address}`],
    );
    const key = await db.query(
      `insert into public_keys
         (chain_type, address, created_at, updated_at, user_id, auth_provider_id)
       values ('evm', $1, 1, 1, $2, $3)
       returning id`,
      [address, source, identity.rows[0].id],
    );
    // A delegation pairs the key with its owner, so both must move together.
    await db.query(
      `insert into signing_delegations
         (user_id, auth_provider_id, public_key_id, provider, kind, secret_handle)
       values ($1, $2, $3, 'privy', 'session', $4)`,
      [source, identity.rows[0].id, key.rows[0].id, `handle-${suffix}`],
    );
    await db.query(
      `insert into user_credits_records
         (account_id, amount_microusd, entry_kind, payment_method,
          payment_provider, external_payment_reference, idempotency_key,
          created_at)
       values ($1, 42000, 'purchase', 'x402', 'coinbase', $2, $2, 1),
              ($3, 10000, 'purchase', 'x402', 'coinbase', $4, $4, 1)`,
      [source, `ref-s-${suffix}`, target, `ref-t-${suffix}`],
    );
    await db.query(
      `insert into user_model_keys
         (user_id, provider, key_ciphertext, created_at, updated_at)
       values ($1, 'openai', 'target-key', 1, 1),
              ($2, 'openai', 'source-key', 1, 1),
              ($2, 'anthropic', 'source-key', 1, 1)`,
      [target, source],
    );

    expect(
      await previewAccountMerge({
        sourceUserId: source,
        targetUserId: target,
        db,
      }),
    ).toMatchObject({
      chats: 2,
      wallets: 1,
      creditsMicrousd: 42000,
      dropped: ["OpenAI model key"],
    });

    await expect(
      mergeAccountRows({ sourceUserId: source, targetUserId: target, db }),
    ).resolves.toEqual({ chats: 2, wallets: 1, dropped: ["OpenAI model key"] });

    const users = await db.query(
      `select id, status, merged_into from users where id in ($1, $2) order by id`,
      [source, target],
    );
    expect(users.rows).toEqual([
      { id: source, status: "merged", merged_into: target },
      { id: target, status: "active", merged_into: null },
    ]);
    const owned = await db.query(
      `select
         (select count(*)::int from threads where user_id = $1) as chats,
         (select count(*)::int from public_keys where user_id = $1) as wallets,
         (select sum(amount_microusd)::int from user_credits_records
           where account_id = $1) as credits,
         (select array_agg(key_ciphertext order by provider) from user_model_keys
           where user_id = $1) as keys`,
      [target],
    );
    expect(owned.rows[0]).toEqual({
      chats: 3,
      wallets: 1,
      credits: 52000,
      keys: ["source-key", "target-key"],
    });

    // Guard: no account-keyed column outside Better Auth still names the source.
    const columns = await db.query(
      `select c.table_name, c.column_name
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
          and c.column_name in ('user_id', 'account_id', 'owner_user_id', 'claimed_user_id')
          and c.data_type = 'text' and c.table_name not like 'ba\\_%'`,
    );
    for (const { table_name, column_name } of columns.rows) {
      const left = await db.query(
        `select count(*)::int as n from "${table_name}" where "${column_name}" = $1`,
        [source],
      );
      expect({ table: table_name, rows: left.rows[0].n }).toEqual({
        table: table_name,
        rows: 0,
      });
    }
  });
});
