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
    for (const migration of [
      "20261007000000_account_merge.sql",
      "20261017010000_telegram_link.sql",
    ])
      await db.query(readFileSync(new URL(migration, fixtureUrl), "utf8"));
  });

  async function accounts(prefix: string) {
    const target = `${prefix}-target-${randomUUID()}`;
    const source = `${prefix}-source-${randomUUID()}`;
    await db.query(
      "insert into users (id, username) values ($1, $1), ($2, $2)",
      [target, source],
    );
    return { target, source };
  }

  /** Run `work`, expecting it to fail with `code`, and undo what it did. */
  async function refused(code: string, work: () => Promise<unknown>) {
    await db.query("savepoint refused");
    await expect(work()).rejects.toThrow(code);
    await db.query("rollback to savepoint refused");
  }

  const statuses = async (...ids: string[]) =>
    (
      await db.query(
        "select id, status from users where id = any($1) order by id",
        [ids],
      )
    ).rows;

  async function commit(user: string, state: string, signed: boolean) {
    const row = await db.query(
      `insert into commits (user_id, state, commit_request, signed_blob)
       values ($1, $2, '{}', $3) returning id`,
      [user, state, signed ? '{"kind":"signed"}' : null],
    );
    return String(row.rows[0].id);
  }

  afterAll(async () => {
    await db?.query("rollback");
    db?.release();
    await pool?.end();
    if (databaseCreated) await admin.query(`drop database "${databaseName}"`);
    await admin?.end();
  });

  it("moves account data, drops all source secrets and preserves target secrets", async () => {
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
              ($2, 'anthropic', 'source-key', 1, 1),
              ($1, 'openrouter', 'target-only-key', 1, 1)`,
      [target, source],
    );

    const app = await db.query(
      `insert into applications (name, label) values ('search', 'Search app') returning id`,
    );
    await db.query(
      `insert into user_application_secrets
         (user_id, application_id, slot_name, secret_ciphertext)
       values ($1, $3, 'api_key', 'target-secret'),
              ($1, $3, 'target_only', 'target-only-secret'),
              ($2, $3, 'api_key', 'source-secret'),
              ($2, $3, 'token', 'source-only-secret')`,
      [target, source, app.rows[0].id],
    );
    const dropped = [
      "Anthropic model key (re-enter it after merging)",
      "OpenAI model key (you already have one here)",
      "Search app · api_key (you already have one here)",
      "Search app · token (re-enter it after merging)",
    ];

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
      dropped,
    });

    await expect(
      mergeAccountRows({ sourceUserId: source, targetUserId: target, db }),
    ).resolves.toEqual({ chats: 2, wallets: 1, dropped });

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
      keys: ["target-key", "target-only-key"],
    });

    const secrets = await db.query(
      `select user_id, application_id, slot_name, secret_ciphertext
         from user_application_secrets order by slot_name`,
    );
    expect(secrets.rows).toEqual([
      {
        user_id: target,
        application_id: app.rows[0].id,
        slot_name: "api_key",
        secret_ciphertext: "target-secret",
      },
      {
        user_id: target,
        application_id: app.rows[0].id,
        slot_name: "target_only",
        secret_ciphertext: "target-only-secret",
      },
    ]);

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
  it("keeps both accounts intact until the payment lock is released", async () => {
    const target = `billing-target-${randomUUID()}`;
    const source = `billing-source-${randomUUID()}`;
    await db.query(
      "insert into users (id, username) values ($1, $1), ($2, $2)",
      [target, source],
    );
    await db.query(
      "insert into account_payment_locks (account_id, expires_at) values ($1, extract(epoch from now())::bigint + 60)",
      [target],
    );
    await db.query("savepoint pending_billing");
    await expect(
      mergeAccountRows({ sourceUserId: source, targetUserId: target, db }),
    ).rejects.toThrow("account_merge_payment_in_progress");
    await db.query("rollback to savepoint pending_billing");
    const accounts = await db.query(
      "select status from users where id in ($1, $2)",
      [target, source],
    );
    expect(accounts.rows).toEqual([{ status: "active" }, { status: "active" }]);
    await db.query("delete from account_payment_locks where account_id = $1", [
      target,
    ]);
    await expect(
      mergeAccountRows({ sourceUserId: source, targetUserId: target, db }),
    ).resolves.toMatchObject({ chats: 0, wallets: 0 });
  });

  it("refuses while a source commit is in flight, and cancels only unsigned ones", async () => {
    const { target, source } = await accounts("in-flight");
    const parked = await commit(source, "awaiting_approval", false);
    const unsigned = await commit(source, "needs_signature", false);
    const submitted = await commit(source, "submitted", true);
    const targetParked = await commit(target, "awaiting_approval", false);
    const merge = () =>
      mergeAccountRows({ sourceUserId: source, targetUserId: target, db });

    await refused("account_merge_commits_in_flight", merge);
    expect(await statuses(source, target)).toEqual([
      { id: source, status: "active" },
      { id: target, status: "active" },
    ]);
    const untouched = await db.query(
      "select state, version from commits where id = any($1) order by state",
      [[parked, unsigned]],
    );
    expect(untouched.rows).toEqual([
      { state: "awaiting_approval", version: "1" },
      { state: "needs_signature", version: "1" },
    ]);

    // A signature with no broadcast yet holds the merge too.
    await db.query("update commits set state = 'confirmed' where id = $1", [
      submitted,
    ]);
    const signing = await commit(source, "needs_signature", true);
    await refused("account_merge_commits_in_flight", merge);
    await db.query("update commits set state = 'failed' where id = $1", [
      signing,
    ]);

    await expect(merge()).resolves.toMatchObject({ chats: 0 });
    const rows = await db.query(
      `select id, user_id, state, failure_code, version from commits
        where id = any($1)`,
      [[parked, unsigned, submitted, signing, targetParked]],
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    for (const id of [parked, unsigned])
      expect(byId.get(id)).toMatchObject({
        user_id: target,
        state: "rejected",
        failure_code: "commit_account_merged",
        version: "2",
      });
    expect(byId.get(submitted)).toMatchObject({
      user_id: target,
      state: "confirmed",
      failure_code: null,
      version: "1",
    });
    // The survivor's own parked commit never changes owner, so it stays.
    expect(byId.get(targetParked)).toMatchObject({
      state: "awaiting_approval",
      version: "1",
    });
  });

  it("reports how many commits it cancelled", async () => {
    const { target, source } = await accounts("cancel-count");
    await commit(source, "awaiting_approval", false);
    const merged = await db.query("select merge_accounts($1, $2) as merged", [
      source,
      target,
    ]);
    expect(merged.rows[0].merged).toMatchObject({ cancelled: 1 });
  });

  it("keeps both agent wallets; the older key stays the default", async () => {
    const { target, source } = await accounts("wallets");
    const wallet = async (user: string, keyAt: number) => {
      const key = await db.query(
        `insert into public_keys (chain_type, address, created_at, updated_at, user_id)
         values ('evm', $1, $2, $2, $3)
         returning id`,
        [`0x${randomUUID().replaceAll("-", "")}`, keyAt, user],
      );
      const row = await db.query(
        `insert into agent_wallets
           (user_id, chain_type, public_key_id, para_subject, status, is_default,
            created_at, updated_at)
         values ($1, 'evm', $2, $3, 'active', true, 1, 1)
         returning id`,
        [user, key.rows[0].id, `p-${user}`],
      );
      return row.rows[0].id;
    };
    const kept = await wallet(target, 2);
    const moved = await wallet(source, 1);

    await mergeAccountRows({ sourceUserId: source, targetUserId: target, db });

    const rows = await db.query(
      `select id, user_id, is_default, merged_at is not null as merged
         from agent_wallets where id = any($1) order by id`,
      [[kept, moved]],
    );
    expect(rows.rows).toEqual([
      {
        id: kept,
        user_id: target,
        is_default: false,
        merged: false,
      },
      {
        id: moved,
        user_id: target,
        is_default: true,
        merged: true,
      },
    ]);
  });

  it("refuses a merge across a live link fence, and lifts the rest", async () => {
    const { target, source } = await accounts("fence");
    const own = randomUUID();
    const fence = (account: string, mergeId: string, ttl = 60) =>
      db.query(
        `insert into account_merge_fences
           (fenced_account, merge_id, reason, created_at, expires_at)
         values ($1, $2, 'telegram_link', extract(epoch from now())::bigint,
                 extract(epoch from now())::bigint + $3)
         on conflict (fenced_account) do update
           set merge_id = excluded.merge_id, expires_at = excluded.expires_at`,
        [account, mergeId, ttl],
      );
    await fence(source, own);
    await fence(target, own);

    // A #716 merge waits while a link holds the accounts.
    await refused("account_merge_in_progress", () =>
      mergeAccountRows({ sourceUserId: source, targetUserId: target, db }),
    );

    // The link lifts its own fences in the merge's transaction; an expired
    // fence of another merge no longer counts.
    await db.query("delete from account_merge_fences where merge_id = $1", [
      own,
    ]);
    await fence(target, randomUUID(), -1);
    await db.query("select merge_accounts($1, $2)", [source, target]);
    const left = await db.query(
      `select fenced_account from account_merge_fences
        where fenced_account = any($1)`,
      [[source, target]],
    );
    expect(left.rows).toEqual([]);
    expect(await statuses(source)).toEqual([{ id: source, status: "merged" }]);
  });

  it("keeps fences and link codes out of the ownership sweep", async () => {
    const swept = await db.query(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and table_name in ('account_merge_fences', 'telegram_link_codes')
          and column_name in ('user_id', 'account_id', 'owner_user_id', 'claimed_user_id')`,
    );
    expect(swept.rows).toEqual([]);
  });

  it("refuses two live World handovers for one bot", async () => {
    const { target, source } = await accounts("world");
    const bot = `bot-${randomUUID()}`;
    await db.query(
      `insert into bot_registrations
         (id, platform, status, platform_bot_id, created_at, updated_at)
       values ($1, 'telegram', 'active', $1, 1, 1)`,
      [bot],
    );
    const handover = (user: string, state: string) =>
      db.query(
        `insert into bot_handover_tokens
           (bot_registration_id, state, claimed_user_id, owner_address)
         values ($1, $2, $3, '0xowner') returning id`,
        [bot, state, user],
      );
    await handover(target, "active");
    const sourceHandover = (await handover(source, "claimed")).rows[0].id;
    await refused("account_merge_handover_conflict", () =>
      mergeAccountRows({ sourceUserId: source, targetUserId: target, db }),
    );

    // Once one is revoked, the other moves to the survivor.
    await db.query(
      "update bot_handover_tokens set state = 'revoked' where id = $1",
      [sourceHandover],
    );
    await mergeAccountRows({ sourceUserId: source, targetUserId: target, db });
    const owners = await db.query(
      "select claimed_user_id from bot_handover_tokens where bot_registration_id = $1",
      [bot],
    );
    expect(owners.rows).toEqual([
      { claimed_user_id: target },
      { claimed_user_id: target },
    ]);
  });
});
