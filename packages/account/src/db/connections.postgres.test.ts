// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const connectionString = process.env.AOMI_AUTH_TEST_DATABASE_URL;
const databaseName = `aomi_auth_loopback_test_connections_${randomUUID().replaceAll("-", "")}`;
const enabled = Boolean(
  connectionString && process.env.AOMI_TEST_DATABASE_DISPOSABLE === "1",
);
const origin = "http://localhost:3999";
const TRADING = "6f1c2b8e-0000-4000-8000-000000000001";
const HOODIT = "6f1c2b8e-0000-4000-8000-000000000002";
const OLD = "6f1c2b8e-0000-4000-8000-000000000003";

// skip-reason: Requires an explicitly disposable loopback PostgreSQL database; CI supplies it.
describe.skipIf(!enabled)("account connections", () => {
  let pool: Pool;
  let admin: Pool;
  let databaseCreated = false;
  let connections: typeof import("../service/connections");

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (
      !/^(localhost|127\.0\.0\.1)$/.test(url.hostname) ||
      !url.pathname.startsWith("/aomi_auth_loopback_test")
    ) {
      throw new Error(
        "Connection tests require a disposable loopback auth database",
      );
    }
    admin = new Pool({ connectionString });
    await admin.query(`create database "${databaseName}"`);
    databaseCreated = true;
    url.pathname = `/${databaseName}`;
    vi.stubEnv("DATABASE_URL", url.toString());
    vi.stubEnv("BETTER_AUTH_URL", origin);
    vi.stubEnv("AOMI_AUTH_EMAIL_DOMAIN", "aomi.dev");
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(
      readFileSync(
        new URL(
          "../../../../tests/e2e/fixtures/canonical-account-schema.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const { auth } = await import("../better-auth/auth");
    await (await getMigrations(auth.options)).runMigrations();
    connections = await import("../service/connections");
    await seed();
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    if (connections) await (await import("./pool")).getPool().end();
    if (databaseCreated) await admin.query(`drop database "${databaseName}"`);
    await admin?.end();
    vi.unstubAllEnvs();
  });

  // Account "owner" signs in through two Better Auth users; "other" through one.
  async function seed() {
    await pool.query(
      `insert into users (id) values ('owner'), ('other'), ('no-telegram')`,
    );
    await pool.query(
      `insert into ba_users (id, name, email, email_verified, created_at, updated_at)
       select id, id, id || '@example.test', true, now(), now()
         from unnest(array['ba-1', 'ba-2', 'ba-3']) as id`,
    );
    await pool.query(
      `insert into auth_providers
         (user_id, provider, issuer_environment, tenant_id, subject, method,
          value, provider_metadata, created_at, updated_at)
       values ('owner', 'betterauth', 'aomi', 'global', 'ba-1', 'session', 'ba-1', '{}', 1, 1),
              ('owner', 'better_auth', 'aomi', 'global', 'ba-2', 'session', 'ba-2', '{}', 1, 1),
              ('other', 'betterauth', 'aomi', 'global', 'ba-3', 'session', 'ba-3', '{}', 1, 1),
              ('owner', 'telegram', 'aomi', 'global', '42', 'telegram', '42',
               '{"handle": "arixon"}', 1, 1)`,
    );
    await pool.query(
      `insert into ba_oauth_clients (id, client_id, name, redirect_uris, created_at, updated_at)
       values ('1', 'claude', 'Claude Code', '["http://127.0.0.1/cb"]', now(), now()),
              ('2', 'cli', 'Aomi CLI', '["http://127.0.0.1/cb"]', now(), now()),
              ('3', 'partner', 'Partner app', '["https://partner.test/cb"]', now(), now()),
              ('4', 'codex', null, '["http://127.0.0.1/cb"]', now(), now())`,
    );
    await pool.query(
      `insert into ba_oauth_resources (id, identifier, name, created_at, updated_at)
       values ('r1', $1, 'Agent MCP', now(), now())`,
      [`${origin}/v1/agent/mcp`],
    );
    await pool.query(
      `insert into ba_oauth_client_resources (id, client_id, resource_id, created_at)
       values ('cr1', 'claude', $1, now())`,
      [`${origin}/v1/agent/mcp`],
    );
    // claude: bound to Agent MCP. codex: its consent names Pipeline MCP.
    await pool.query(
      `insert into ba_oauth_consents (id, client_id, user_id, scopes, resources, created_at, updated_at)
       values ('c1', 'claude', 'ba-1', '["mcp:agent"]', null, to_timestamp(1760400000), now()),
              ('c2', 'partner', 'ba-2', '["agent:read"]', null, to_timestamp(1760400100), now()),
              ('c3', 'codex', 'ba-1', '["mcp:pipeline"]', $1, to_timestamp(1760400300), now()),
              ('c4', 'claude', 'ba-3', '["mcp:agent"]', null, to_timestamp(1760400000), now())`,
      [JSON.stringify([`${origin}/v1/pipeline/mcp`])],
    );
    // The CLI's device grant leaves a refresh token and no consent; an
    // expired or revoked one is not a connection.
    await pool.query(
      `insert into ba_oauth_refresh_tokens (id, token, client_id, user_id, scopes, expires_at, created_at, revoked)
       values ('t1', 't1', 'cli', 'ba-2', '["agent:read"]', now() + interval '1 day', to_timestamp(1760400200), null),
              ('t2', 't2', 'claude', 'ba-1', '["mcp:agent"]', now() + interval '1 day', to_timestamp(1760400400), null),
              ('t3', 't3', 'partner', 'ba-3', '["agent:read"]', now() - interval '1 day', to_timestamp(1760400000), null),
              ('t4', 't4', 'partner', 'ba-3', '["agent:read"]', now() + interval '1 day', to_timestamp(1760400000), now())`,
    );
    await pool.query(
      `insert into ba_oauth_access_tokens (id, token, client_id, user_id, refresh_id, scopes, expires_at, created_at)
       values ('a1', 'a1', 'claude', 'ba-1', null, '["mcp:agent"]', now() + interval '5 minutes', now())`,
    );
    await pool.query(
      `insert into bot_registrations
         (id, owner_user_id, platform, status, label, platform_bot_id,
          platform_username, created_at, updated_at)
       values ('b1', null, 'telegram', 'active', 'Hoodit', '7712345678', 'HooditBot', 1, 1),
              ('b2', null, 'telegram', 'active', 'Side bot', '88', null, 2, 2),
              ('b3', null, 'telegram', 'disabled', null, '99', 'OldBot', 3, 3),
              ('b4', null, 'telegram', 'active', null, '555', 'UnusedBot', 4, 4)`,
    );
    await pool.query(
      `insert into threads (id, user_id)
       values ('telegram:bot:7712345678:dm:42', 'owner'),
              ('telegram:bot:7712345678:dm:42:new:ab', 'owner'),
              ('telegram:bot:88:dm:42', 'owner'),
              ('telegram:bot:99:dm:42', 'owner'),
              ('telegram:bot:555:dm:7', 'other'),
              ('telegram:bot:5550:dm:42', 'owner')`,
    );
    // The owner renamed Claude, let it trade from "Trading" without asking
    // (an archived wallet's pair is kept, marked) and used it last. The side bot
    // is locked to Hoodit, asks before every trade, and may use "Hoodit".
    await pool.query(
      `insert into applications (id, name, label) values (86, 'hoodit', 'Hoodit')`,
    );
    await pool.query(
      `insert into agent_wallets
         (id, user_id, name, para_subject, archived_at, created_by_app, created_at, updated_at)
       values ($1, 'owner', 'Trading', 'p-trading', null, null, 1, 1),
              ($2, 'owner', 'Hoodit', 'p-hoodit', null, 86, 2, 2),
              ($3, 'owner', 'Old', 'p-old', 5, null, 3, 3)`,
      [TRADING, HOODIT, OLD],
    );
    await pool.query(
      `insert into account_connections
         (user_id, key, label, application_id, ask_only, last_used_at, created_at, updated_at)
       values ('owner', 'oauth:claude', 'Laptop Claude', null, false, 1760409000, 1, 1),
              ('owner', 'telegram:88', null, 86, true, 1760408000, 1, 1)`,
    );
    await pool.query(
      `insert into wallet_access
         (user_id, connection_key, agent_wallet_id, instant, created_at, updated_at)
       values ('owner', 'oauth:claude', $1, true, 1, 1),
              ('owner', 'oauth:claude', $3, true, 1, 1),
              ('owner', 'telegram:88', $2, false, 1, 1)`,
      [TRADING, HOODIT, OLD],
    );
    // Owner was linked from Hoodit, then a later code from the side bot was
    // only issued; "other" was linked from the side bot.
    await pool.query(
      `insert into account_link_codes
         (code_hash, source_user_id, provider, subject, handle, context, state,
          target_user_id, merge_id, created_at, expires_at, consumed_at)
       values (repeat('a', 64), 'no-telegram', 'telegram', '42', 'arixon',
               '{"bot_id": "7712345678", "bot_registration_id": "b1", "chat_id": 42}',
               'linked', 'owner', gen_random_uuid(), 1760400000, 1760400600, 1760400500),
              (repeat('b', 64), 'no-telegram', 'telegram', '42', 'arixon',
               '{"bot_id": "88", "bot_registration_id": "b2", "chat_id": 42}',
               'issued', null, null, 1760400700, 1760401300, null),
              (repeat('c', 64), 'no-telegram', 'telegram', '7', null,
               '{"bot_id": "88", "bot_registration_id": "b2", "chat_id": 7}',
               'linked', 'other', gen_random_uuid(), 1760400000, 1760400600, 1760400100)`,
    );
  }

  const portal = {
    key: "portal",
    kind: "portal",
    name: "Aomi",
    detail: null,
    application: null,
    ask_only: false,
    wallets: [],
    last_used_at: null,
    connected_at: null,
    removable: false,
  };
  const oauth = (
    client: string,
    kind: string,
    name: string,
    connected: number,
    extra: Record<string, unknown> = {},
  ) => ({
    key: `oauth:${client}`,
    kind,
    name,
    detail: null,
    application: null,
    ask_only: false,
    wallets: [],
    last_used_at: null,
    connected_at: connected,
    removable: true,
    ...extra,
  });
  const bot = (
    id: string,
    name: string,
    extra: Record<string, unknown> = {},
  ) => ({
    key: `telegram:${id}`,
    kind: "telegram",
    name,
    detail: "Telegram @arixon",
    application: null,
    ask_only: false,
    wallets: [],
    last_used_at: null,
    connected_at: null,
    removable: true,
    ...extra,
  });

  it("lists the portal, then each OAuth client and Telegram bot by last use", async () => {
    expect(await connections.listAccountConnections("owner")).toEqual({
      connections: [
        portal,
        oauth("claude", "ai", "Laptop Claude", 1760400000, {
          // The archived wallet's pair stays, marked, for a restore.
          wallets: [
            { id: TRADING, name: "Trading", instant: true, archived: false },
            { id: OLD, name: "Old", instant: true, archived: true },
          ],
          last_used_at: 1760409000,
        }),
        bot("88", "Side bot", {
          application: { id: 86, name: "hoodit", label: "Hoodit" },
          ask_only: true,
          wallets: [
            { id: HOODIT, name: "Hoodit", instant: false, archived: false },
          ],
          last_used_at: 1760408000,
        }),
        oauth("partner", "app", "Partner app", 1760400100),
        oauth("cli", "cli", "Aomi CLI", 1760400200),
        oauth("codex", "ai", "codex", 1760400300),
        bot("7712345678", "@HooditBot"),
      ],
    });
  });

  it("lists only the portal and its own clients for another account", async () => {
    expect(await connections.listAccountConnections("other")).toEqual({
      connections: [portal, oauth("claude", "ai", "Claude Code", 1760400000)],
    });
    expect(await connections.listAccountConnections("no-telegram")).toEqual({
      connections: [portal],
    });
  });

  it("disconnects one client for this account only", async () => {
    expect(
      await connections.revokeOAuthConnection({
        userId: "owner",
        clientId: "claude",
      }),
    ).toBe(true);
    const left = await pool.query(
      `select 'consent' as kind, user_id from ba_oauth_consents where client_id = 'claude'
       union all select 'refresh', user_id from ba_oauth_refresh_tokens where client_id = 'claude'
       union all select 'access', user_id from ba_oauth_access_tokens where client_id = 'claude'`,
    );
    expect(left.rows).toEqual([{ kind: "consent", user_id: "ba-3" }]);
    expect(
      (await connections.listAccountConnections("owner")).connections
        .filter((row) => row.key.startsWith("oauth:"))
        .map((row) => row.key),
    ).toEqual(["oauth:partner", "oauth:cli", "oauth:codex"]);
    const settings = await pool.query(
      `select key from account_connections where user_id = 'owner' order by key`,
    );
    expect(settings.rows).toEqual([{ key: "telegram:88" }]);
    // Its lanes went with it.
    const lanes = await pool.query(
      `select connection_key from wallet_access where user_id = 'owner'`,
    );
    expect(lanes.rows).toEqual([{ connection_key: "telegram:88" }]);
    expect(
      await connections.revokeOAuthConnection({
        userId: "owner",
        clientId: "claude",
      }),
    ).toBe(false);
    expect(
      await connections.revokeOAuthConnection({
        userId: "no-telegram",
        clientId: "partner",
      }),
    ).toBe(false);
  });

  it("unlinks Telegram only while another sign-in remains", async () => {
    expect(
      await connections.unlinkTelegramConnection({ userId: "owner" }),
    ).toBe("last_factor");
    await pool.query(
      `insert into auth_providers
         (user_id, provider, issuer_environment, tenant_id, subject, method,
          value, provider_metadata, created_at, updated_at)
       values ('owner', 'email', 'aomi', 'global', 'o@example.test', 'email',
               'o@example.test', '{}', 1, 1)`,
    );
    expect(
      await connections.unlinkTelegramConnection({ userId: "owner" }),
    ).toBe("revoked");
    const left = await pool.query(
      `select provider from auth_providers where user_id = 'owner' and provider = 'telegram'
       union all select key from account_connections where user_id = 'owner' and key like 'telegram:%'`,
    );
    expect(left.rows).toEqual([]);
    expect(
      (await connections.listAccountConnections("owner")).connections.some(
        (row) => row.kind === "telegram",
      ),
    ).toBe(false);
    expect(
      await connections.unlinkTelegramConnection({ userId: "owner" }),
    ).toBe("not_found");
  });
});
