// @vitest-environment node

import type { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const DATABASE_URL = process.env.AOMI_AUTH_TEST_DATABASE_URL;
const PORTAL_ORIGIN = "http://127.0.0.1:3001";
const AGENT_MCP_RESOURCE = `${PORTAL_ORIGIN}/v1/agent/mcp`;
const TEST_RESOURCE_ID = "oauth-loopback-route-test-agent-mcp";
const CODEX_SCOPES =
  "agent:read agent:write agent:actions:resolve mcp:agent payments:submit " +
  "custody:delegate pipeline:catalog pipeline:execute mcp:pipeline openid " +
  "profile email offline_access";
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;
if (process.env.CI && !DATABASE_URL) {
  throw new Error(
    "CI must provide AOMI_AUTH_TEST_DATABASE_URL for the OAuth route integration suite",
  );
}
const CLEANUP_TABLES = [
  "ba_oauth_access_tokens",
  "ba_oauth_refresh_tokens",
  "ba_oauth_consents",
  "ba_oauth_client_resources",
  "ba_oauth_device_codes",
  "ba_oauth_client_assertions",
  "ba_oauth_clients",
  "ba_accounts",
  "ba_wallet_addresses",
  "ba_sessions",
  "ba_users",
  "ba_verifications",
  "ba_jwks",
] as const;

type Route = (request: Request) => Promise<Response>;

describeWithDatabase("production OAuth route loopback callbacks", () => {
  const originalEnv = { ...process.env };
  let GET: Route;
  let POST: Route;
  let pool: Pool;
  let resourceInserted = false;

  beforeAll(async () => {
    assertDisposableDatabaseUrl(DATABASE_URL!);
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      DATABASE_URL,
      BETTER_AUTH_URL: PORTAL_ORIGIN,
    };
    const database = await import("@aomi-labs/account/db/pool");
    const account = await import("@aomi-labs/account/better-auth");
    pool = database.getPool();
    const { runMigrations } = await getMigrations({
      ...account.auth.options,
      database: pool,
    });
    await runMigrations();
    await assertOAuthSchema(pool);
    const existingResource = await pool.query(
      `select 1 from ba_oauth_resources where identifier = $1`,
      [AGENT_MCP_RESOURCE],
    );
    if (existingResource.rowCount !== 0) {
      throw new Error(
        "AOMI_AUTH_TEST_DATABASE_URL must target a disposable database without the loopback test resource",
      );
    }
    const inserted = await pool.query(
      `insert into ba_oauth_resources
         (id, identifier, name, allowed_scopes, disabled, created_at, updated_at)
       values ($1, $2, $3, $4::jsonb, false, now(), now())
       returning id`,
      [
        TEST_RESOURCE_ID,
        AGENT_MCP_RESOURCE,
        "OAuth loopback route test Agent MCP",
        JSON.stringify([
          "agent:read",
          "agent:write",
          "agent:actions:resolve",
          "mcp:agent",
          "payments:submit",
          "custody:delegate",
          "offline_access",
        ]),
      ],
    );
    resourceInserted = inserted.rows[0]?.id === TEST_RESOURCE_ID;
    if (!resourceInserted)
      throw new Error("Failed to create test OAuth resource");
    const route = await import("../route");
    GET = route.GET;
    POST = route.POST;
  });

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(async () => {
    const failures: unknown[] = [];
    try {
      if (pool && resourceInserted) {
        try {
          await pool.query(
            `delete from ba_oauth_resources where id = $1 and identifier = $2`,
            [TEST_RESOURCE_ID, AGENT_MCP_RESOURCE],
          );
          const leftover = await pool.query(
            `select 1 from ba_oauth_resources where id = $1 or identifier = $2`,
            [TEST_RESOURCE_ID, AGENT_MCP_RESOURCE],
          );
          if (leftover.rowCount !== 0) {
            failures.push(
              new Error("Test OAuth resource cleanup was incomplete"),
            );
          }
        } catch (error) {
          failures.push(error);
        }
      }
      if (pool) {
        try {
          await pool.end();
        } catch (error) {
          failures.push(error);
        }
      }
    } finally {
      process.env = originalEnv;
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "OAuth route suite cleanup failed");
    }
  });

  it.each([
    [
      "IPv4 exact",
      "http://127.0.0.1:43100/callback",
      "http://127.0.0.1:43100/callback",
    ],
    [
      "IPv4 changed port",
      "http://127.0.0.1:43100/callback",
      "http://127.0.0.1:53100/callback",
    ],
    [
      "IPv6 exact",
      "http://[::1]:43101/callback",
      "http://[::1]:43101/callback",
    ],
    [
      "IPv6 changed port",
      "http://[::1]:43101/callback",
      "http://[::1]:53101/callback",
    ],
  ])(
    "accepts %s through the real handler",
    async (_name, registered, requested) => {
      await withCleanTestRows(pool, async () => {
        const clientId = await registerClient(POST, pool, registered, "native");

        const response = await authorize(GET, clientId, requested);

        expect(response.status).toBe(302);
        const location = response.headers.get("location");
        expect(location).toBeTruthy();
        expect(new URL(location!, PORTAL_ORIGIN).pathname).toBe(
          "/oauth/authorize",
        );
      });
    },
  );

  it.each([
    [
      "localhost port variance",
      "http://localhost:43102/callback",
      "http://localhost:53102/callback",
      "native",
    ],
    [
      "changed host",
      "http://127.0.0.1:43103/callback",
      "http://127.0.0.2:53103/callback",
      "native",
    ],
    [
      "changed protocol",
      "http://127.0.0.1:43104/callback",
      "https://127.0.0.1:53104/callback",
      "native",
    ],
    [
      "changed path",
      "http://127.0.0.1:43105/callback",
      "http://127.0.0.1:53105/other",
      "native",
    ],
    [
      "changed query",
      "http://127.0.0.1:43106/callback?source=codex",
      "http://127.0.0.1:53106/callback?source=other",
      "native",
    ],
    [
      "credentials",
      "http://127.0.0.1:43107/callback",
      "http://user@127.0.0.1:53107/callback",
      "native",
    ],
    [
      "empty userinfo",
      "http://127.0.0.1:43110/callback",
      "http://@127.0.0.1:53110/callback",
      "native",
    ],
    [
      "fragment",
      "http://127.0.0.1:43108/callback",
      "http://127.0.0.1:53108/callback#complete",
      "native",
    ],
    [
      "empty fragment",
      "http://127.0.0.1:43111/callback",
      "http://127.0.0.1:53111/callback#",
      "native",
    ],
    [
      "empty query",
      "http://127.0.0.1:43112/callback",
      "http://127.0.0.1:53112/callback?",
      "native",
    ],
    [
      "non-loopback IP port variance",
      "https://192.0.2.1:43109/callback",
      "https://192.0.2.1:53109/callback",
      "web",
    ],
  ])(
    "rejects %s through the real handler",
    async (_name, registered, requested, applicationType) => {
      await withCleanTestRows(pool, async () => {
        const clientId = await registerClient(
          POST,
          pool,
          registered,
          applicationType,
        );

        const response = await authorize(GET, clientId, requested);

        expect(response.status).toBe(302);
        const location = response.headers.get("location");
        expect(location).toBeTruthy();
        const error = new URL(location!, PORTAL_ORIGIN);
        expect(error.pathname).toBe("/api/auth/error");
        expect(error.searchParams.get("error")).toBe(
          _name === "fragment" || _name === "empty fragment"
            ? "invalid_request"
            : "invalid_redirect",
        );
      });
    },
  );
});

function assertDisposableDatabaseUrl(value: string): void {
  const url = new URL(value);
  const database = url.pathname.slice(1);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) ||
    !/^aomi_auth_loopback_test(?:_|$)/.test(database)
  ) {
    throw new Error(
      "AOMI_AUTH_TEST_DATABASE_URL must be a loopback PostgreSQL database named aomi_auth_loopback_test*",
    );
  }
}

async function registerClient(
  POST: Route,
  pool: Pool,
  redirectUri: string,
  applicationType: string,
): Promise<string> {
  const response = await POST(
    new Request(`${PORTAL_ORIGIN}/api/auth/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "OAuth loopback route integration test",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: applicationType,
        scope: CODEX_SCOPES,
      }),
    }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { client_id?: unknown };
  expect(body.client_id).toEqual(expect.any(String));
  const clientId = String(body.client_id);
  const stored = await pool.query(
    `select redirect_uris from ba_oauth_clients where client_id = $1`,
    [clientId],
  );
  expect(stored.rows[0]?.redirect_uris).toEqual([
    new URL(redirectUri).toString(),
  ]);
  return clientId;
}

async function authorize(
  GET: Route,
  clientId: string,
  redirectUri: string,
): Promise<Response> {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CODEX_SCOPES,
    resource: AGENT_MCP_RESOURCE,
    state: "route-test-state",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
  });
  return GET(
    new Request(`${PORTAL_ORIGIN}/api/auth/oauth2/authorize?${query}`),
  );
}

async function assertOAuthSchema(pool: Pool): Promise<void> {
  const result = await pool.query(
    `select to_regclass('public.ba_oauth_clients') as clients,
            to_regclass('public.ba_verifications') as verifications`,
  );
  if (!result.rows[0]?.clients || !result.rows[0]?.verifications) {
    throw new Error(
      "AOMI_AUTH_TEST_DATABASE_URL must target a disposable database with the current Better Auth migrations",
    );
  }
}

async function tableIds(pool: Pool): Promise<Map<string, Set<string>>> {
  const ids = new Map<string, Set<string>>();
  for (const table of CLEANUP_TABLES) {
    const result = await pool.query(`select id from ${table}`);
    ids.set(table, new Set(result.rows.map((row) => String(row.id))));
  }
  return ids;
}

async function withCleanTestRows<T>(
  pool: Pool,
  run: () => Promise<T>,
): Promise<T> {
  const before = await tableIds(pool);
  let result: T | undefined;
  let failure: unknown;
  try {
    result = await run();
  } catch (error) {
    failure = error;
  } finally {
    try {
      await removeNewRows(pool, before);
    } catch (cleanupError) {
      failure = failure
        ? new AggregateError(
            [failure, cleanupError],
            "OAuth route assertion and cleanup both failed",
          )
        : cleanupError;
    }
  }
  if (failure) throw failure;
  return result as T;
}

async function removeNewRows(
  pool: Pool,
  before: Map<string, Set<string>>,
): Promise<void> {
  const failures: unknown[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const table of CLEANUP_TABLES) {
      try {
        const previous = before.get(table);
        if (!previous) throw new Error(`Missing cleanup baseline for ${table}`);
        const result = await pool.query(`select id from ${table}`);
        const created = result.rows
          .map((row) => String(row.id))
          .filter((id) => !previous.has(id));
        if (created.length > 0) {
          await pool.query(`delete from ${table} where id = any($1::text[])`, [
            created,
          ]);
        }
      } catch (error) {
        failures.push(error);
      }
    }
  }
  for (const table of CLEANUP_TABLES) {
    try {
      const previous = before.get(table);
      if (!previous) throw new Error(`Missing cleanup baseline for ${table}`);
      const result = await pool.query(`select id from ${table}`);
      const leftovers = result.rows
        .map((row) => String(row.id))
        .filter((id) => !previous.has(id));
      if (leftovers.length > 0) {
        failures.push(
          new Error(
            `${table} retained ${leftovers.length} test-created row(s)`,
          ),
        );
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "OAuth route row cleanup failed");
  }
}
