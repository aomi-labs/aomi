// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAccountRateLimitStorage } from "./rate-limit";
import { setAccountInternalFailureObserver } from "./observability";

const RATE_LIMITS_SQL = readFileSync(
  new URL("./db/rate-limits.sql", import.meta.url),
  "utf8",
);
const connectionString = process.env.AOMI_AUTH_TEST_DATABASE_URL;
const enabled = Boolean(
  connectionString && process.env.AOMI_TEST_DATABASE_DISPOSABLE === "1",
);
const schema = "limiter_" + randomUUID().replaceAll("-", "");
let admin: Pool;
let database: Pool;
// skip-reason: Requires the explicitly marked disposable PostgreSQL fixture; integration validation runs it with that fixture.
describe.skipIf(!enabled)("shared fixed-window rate limits", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString });
    await admin.query(`CREATE SCHEMA ${schema}`);
    database = new Pool({
      connectionString,
      options: `-c search_path=${schema}`,
      max: 12,
    });
    await database.query(RATE_LIMITS_SQL);
    await database.query(RATE_LIMITS_SQL);
  });
  afterAll(async () => {
    await database?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  it("applies the schema idempotently with row-level security on", async () => {
    const { rows } = await database.query(
      "SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('rate_limits')",
    );
    expect(rows).toEqual([{ relrowsecurity: true }]);
  });

  it("allows exactly the shared budget under concurrent callers", async () => {
    const a = createAccountRateLimitStorage(() => database);
    const b = createAccountRateLimitStorage(() => database);
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        (index % 2 ? a : b).consume("shared-test", { window: 60, max: 10 }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(10);
    expect(
      results
        .filter((result) => !result.allowed)
        .every((result) => result.retryAfter! > 0),
    ).toBe(true);
    expect(
      await b.consume("independent-test", { window: 60, max: 10 }),
    ).toEqual({ allowed: true, retryAfter: null });
  });

  it("keeps the window fixed while traffic stays under the limit", async () => {
    const storage = createAccountRateLimitStorage(() => database);
    await storage.consume("steady-test", { window: 60, max: 3 });
    const expiry = async () =>
      (
        await database.query<{ expires_at: Date }>(
          "SELECT expires_at FROM rate_limits WHERE key = encode(sha256('steady-test'), 'hex')",
        )
      ).rows[0].expires_at.getTime();
    const firstExpiry = await expiry();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await storage.consume("steady-test", { window: 60, max: 3 });
    expect(await expiry()).toBe(firstExpiry);
  });

  it("starts a fresh budget once the window expires", async () => {
    const storage = createAccountRateLimitStorage(() => database);
    for (let i = 0; i < 2; i++)
      await storage.consume("reset-test", { window: 60, max: 2 });
    expect(
      (await storage.consume("reset-test", { window: 60, max: 2 })).allowed,
    ).toBe(false);
    await database.query(
      "UPDATE rate_limits SET expires_at = now() - interval '1 second'",
    );
    expect(await storage.consume("reset-test", { window: 60, max: 2 })).toEqual(
      { allowed: true, retryAfter: null },
    );
  });

  it("allows requests and reports once while the table is missing", async () => {
    const observer = vi.fn();
    setAccountInternalFailureObserver(observer);
    const empty = new Pool({
      connectionString,
      options: `-c search_path=${schema}_missing`,
      max: 1,
    });
    try {
      const storage = createAccountRateLimitStorage(() => empty);
      for (let i = 0; i < 3; i++)
        expect(
          await storage.consume("missing-table", { window: 60, max: 1 }),
        ).toEqual({ allowed: true, retryAfter: null });
      expect(observer).toHaveBeenCalledTimes(1);
      expect(observer.mock.calls[0][0]).toMatchObject({
        kind: "rate_limit_table",
      });
    } finally {
      setAccountInternalFailureObserver(undefined);
      await empty.end();
    }
  });

  it("fails closed on any other store error", async () => {
    const storage = createAccountRateLimitStorage(
      () =>
        ({
          query: async () => {
            throw new Error("store offline");
          },
        }) as unknown as Pool,
    );
    await expect(
      storage.consume("store-outage", { window: 60, max: 10 }),
    ).rejects.toThrow("store offline");
  });
});
