// @vitest-environment node
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const baseDatabaseUrl = process.env.AOMI_AUTH_TEST_DATABASE_URL?.trim();
const schemaName = `aomi_device_grants_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = baseDatabaseUrl
  ? withSearchPath(baseDatabaseUrl, schemaName)
  : undefined;
const describePostgres = isLoopbackPostgres(baseDatabaseUrl)
  ? describe
  : describe.skip;
const execFileAsync = promisify(execFile);
const secret = "postgres-device-auth-test-secret-at-least-32-bytes";
const identifierPrefix = `aomi:device-auth:test-${randomUUID()}:`;
const state = "state_1234567890abcdef";
const verifier = "worker-verifier";
const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
const redirectUri = "http://127.0.0.1:49152/callback";
const portalRoot = fileURLToPath(new URL("../../..", import.meta.url));
const originalDatabaseUrl = process.env.DATABASE_URL;

describePostgres("PostgreSQL device-auth records", () => {
  let pool: ReturnType<typeof import("@aomi-labs/account").getPool>;
  let createDeviceAuthGrantService: typeof import("./grants").createDeviceAuthGrantService;
  let createPostgresDeviceAuthRecordStore: typeof import("./grants").createPostgresDeviceAuthRecordStore;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const account = await import("@aomi-labs/account");
    const grants = await import("./grants");
    pool = account.getPool();
    createDeviceAuthGrantService = grants.createDeviceAuthGrantService;
    createPostgresDeviceAuthRecordStore =
      grants.createPostgresDeviceAuthRecordStore;
    await pool.query(`create schema "${schemaName}"`);
    await pool.query(
      `create table if not exists ba_verifications (
         id text primary key,
         identifier text not null,
         value text not null,
         expires_at timestamptz not null,
         created_at timestamptz not null default now(),
         updated_at timestamptz not null default now()
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

  it("issues in one process and permits exactly one exchange in other processes", async () => {
    const issued = JSON.parse(await worker("issue")) as { code: string };
    const [first, second] = await Promise.all([
      worker("exchange", issued.code),
      worker("exchange", issued.code),
    ]);
    const results = [first, second].map(
      (output) => JSON.parse(output) as { found: boolean; provider?: string },
    );
    expect(results.filter((result) => result.found)).toHaveLength(1);
    expect(results.find((result) => result.found)?.provider).toBe("para");
  });

  it("enforces authenticated payload expiry independently of the DB timestamp", async () => {
    const issued = JSON.parse(await worker("issue", undefined, "1")) as {
      code: string;
    };
    await new Promise((resolve) => setTimeout(resolve, 10));
    await pool.query(
      `update ba_verifications
          set expires_at = now() + interval '1 minute'
        where identifier = $1`,
      [`${identifierPrefix}grant:${issued.code}`],
    );

    await expect(worker("exchange", issued.code)).resolves.toContain(
      '"found":false',
    );
  });

  it("rolls a rejected link transition back and cleans only its expired namespace", async () => {
    const store = createPostgresDeviceAuthRecordStore(
      pool,
      () => true,
      identifierPrefix,
    );
    const grants = createDeviceAuthGrantService({
      secret,
      store,
      identifierPrefix,
    });
    const intent = await grants.issueDeviceAuthLinkIntent({
      state,
      codeChallenge,
      redirectUri,
      betterAuthUserId: "postgres-test-user",
      provider: "privy",
    });
    await expect(
      grants.issueDeviceAuthLinkGrant({
        linkIntent: intent.id,
        state: "different_1234567890",
        redirectUri,
        provider: "privy",
        credential: { provider: "privy" },
      }),
    ).rejects.toThrow("invalid_link_intent");
    await expect(
      grants.issueDeviceAuthLinkGrant({
        linkIntent: intent.id,
        state,
        redirectUri,
        provider: "privy",
        credential: { provider: "privy" },
      }),
    ).resolves.toMatchObject({ purpose: "link", provider: "privy" });

    const expiredDevice = `${identifierPrefix}grant:expired-${randomUUID()}`;
    const unrelated = `unrelated:${randomUUID()}`;
    await pool.query(
      `insert into ba_verifications
         (id, identifier, value, expires_at, created_at, updated_at)
       values ($1, $2, 'expired', now() - interval '1 minute', now(), now()),
              ($3, $4, 'expired', now() - interval '1 minute', now(), now())`,
      [randomUUID(), expiredDevice, randomUUID(), unrelated],
    );
    await grants.issueDeviceAuthGrant({
      state,
      codeChallenge,
      redirectUri,
      sessionToken: "cleanup-test-session",
      expiresAt: null,
      provider: "para",
    });
    const remaining = await pool.query<{ identifier: string }>(
      "select identifier from ba_verifications where identifier = any($1)",
      [[expiredDevice, unrelated]],
    );
    expect(remaining.rows.map((row) => row.identifier)).toEqual([unrelated]);
    await pool.query("delete from ba_verifications where identifier = $1", [
      unrelated,
    ]);
  });
});

async function worker(
  action: "issue" | "exchange",
  code?: string,
  ttlMs?: string,
): Promise<string> {
  const result = await execFileAsync(
    "pnpm",
    ["exec", "tsx", "src/server/device-auth/grants.postgres-worker.ts"],
    {
      cwd: portalRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        AOMI_DEVICE_AUTH_WORKER_ACTION: action,
        AOMI_DEVICE_AUTH_WORKER_SECRET: secret,
        AOMI_DEVICE_AUTH_WORKER_CODE: code,
        AOMI_DEVICE_AUTH_WORKER_TTL_MS: ttlMs,
        AOMI_DEVICE_AUTH_WORKER_IDENTIFIER_PREFIX: identifierPrefix,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, "--conditions=react-server"]
          .filter(Boolean)
          .join(" "),
      },
    },
  );
  return result.stdout;
}

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
