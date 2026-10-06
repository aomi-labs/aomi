// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createAomiUser } from "../src/db/queries";

type QueryCall = {
  sql: string;
  params?: unknown[];
};

function fakeDb(
  handler: (call: QueryCall) => { rows: unknown[]; rowCount?: number },
) {
  const calls: QueryCall[] = [];
  return {
    calls,
    db: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        const call = { sql, params };
        calls.push(call);
        return handler(call);
      }),
    },
  };
}

function userRow(username: unknown) {
  return {
    id: "11112222-3333-4444-5555-666677778888",
    username,
    created_at: 1,
    updated_at: 1,
  };
}

describe("createAomiUser username disambiguation", () => {
  it("uses the derived handle when it is free", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.sql.includes("select 1 from users where username")) {
        return { rows: [], rowCount: 0 };
      }
      if (call.sql.includes("insert into users")) {
        expect(call.params?.[1]).toBe("alice");
        return { rows: [userRow("alice")] };
      }
      throw new Error(`unexpected query: ${call.sql}`);
    });

    const user = await createAomiUser({
      userId: "11112222-3333-4444-5555-666677778888",
      email: "alice@example.com",
      db: db as never,
    });

    expect(user.displayName).toBe("alice");
    // One availability probe, then the insert.
    expect(calls).toHaveLength(2);
  });

  it("falls back to a deterministic suffix when the handle is taken", async () => {
    const { db } = fakeDb((call) => {
      if (call.sql.includes("select 1 from users where username")) {
        // Base handle is already held (e.g. seeded by a third party); the
        // first suffixed variant is free.
        const username = call.params?.[0];
        return username === "alice"
          ? { rows: [{ "?column?": 1 }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (call.sql.includes("insert into users")) {
        // seed = userId without dashes, first suffix is slice(0, 6).
        expect(call.params?.[1]).toBe("alice-111122");
        return { rows: [userRow("alice-111122")] };
      }
      throw new Error(`unexpected query: ${call.sql}`);
    });

    const user = await createAomiUser({
      userId: "11112222-3333-4444-5555-666677778888",
      email: "alice@example.com",
      db: db as never,
    });

    // Login succeeds with a disambiguated handle instead of a 23505 500.
    expect(user.displayName).toBe("alice-111122");
  });

  it("keeps a null username when no handle can be derived", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.sql.includes("insert into users")) {
        expect(call.params?.[1]).toBeNull();
        return { rows: [userRow(null)] };
      }
      throw new Error(`unexpected query: ${call.sql}`);
    });

    const user = await createAomiUser({
      userId: "11112222-3333-4444-5555-666677778888",
      db: db as never,
    });

    expect(user.displayName).toBeNull();
    // No availability probe when there is nothing to disambiguate.
    expect(calls).toHaveLength(1);
  });
});
