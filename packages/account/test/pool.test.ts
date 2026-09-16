import { describe, expect, it } from "vitest";
import budgets from "../src/db/pool-budgets.json";
import {
  resolveAccountConnectionString,
  resolveAccountPoolOptions,
  resolvePortalBudget,
} from "../src/db/pool";

const stagingPooler = `postgresql://postgres.${budgets.staging.project_ref}:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;

describe("resolveAccountConnectionString", () => {
  const sessionPooler =
    "postgresql://postgres.project:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres";

  it("uses Supabase transaction pooling for Vercel functions", () => {
    const resolved = resolveAccountConnectionString(sessionPooler, {
      VERCEL: "1",
    });

    expect(new URL(resolved).port).toBe("6543");
    expect(new URL(resolved).username).toBe("postgres.project");
  });

  it("also normalizes an implicit session-pooler port", () => {
    const resolved = resolveAccountConnectionString(
      "postgresql://postgres.project:secret@aws-0-us-east-1.pooler.supabase.com/postgres",
      { VERCEL: "1" },
    );

    expect(new URL(resolved).port).toBe("6543");
  });

  it("preserves local and persistent-runtime URLs", () => {
    expect(resolveAccountConnectionString(sessionPooler, {})).toBe(
      sessionPooler,
    );
  });

  it("does not rewrite another Postgres provider", () => {
    const connectionString =
      "postgresql://user:secret@db.example.com:5432/aomi";

    expect(
      resolveAccountConnectionString(connectionString, { VERCEL: "1" }),
    ).toBe(connectionString);
  });
});

describe("resolveAccountPoolOptions", () => {
  it("takes the budgeted per-instance allowance on Vercel", () => {
    const portal = budgets.staging.portal;
    expect(resolveAccountPoolOptions({ VERCEL: "1" }, stagingPooler)).toEqual({
      max: portal.max_connections_per_instance,
      idleTimeoutMillis: portal.idle_timeout_ms,
      connectionTimeoutMillis: portal.connection_timeout_ms,
    });
  });

  it("keeps one short-lived connection per Vercel function instance", () => {
    expect(resolveAccountPoolOptions({ VERCEL: "1" })).toEqual({
      max: 1,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 10_000,
    });
  });

  it("keeps the local and persistent-runtime pool defaults", () => {
    expect(resolveAccountPoolOptions({})).toEqual({
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  });
});

describe("resolvePortalBudget", () => {
  it("selects the environment by the connection string's project ref", () => {
    const production = `postgresql://postgres:secret@db.${budgets.production.project_ref}.supabase.co:5432/postgres`;
    expect(resolvePortalBudget(stagingPooler)).toBe(budgets.staging.portal);
    expect(resolvePortalBudget(production)).toBe(budgets.production.portal);
  });

  it("gives a non-Supabase URL the strictest allowance", () => {
    expect(
      resolvePortalBudget("postgresql://user:secret@db.example.com:5432/aomi")
        .max_connections_per_instance,
    ).toBe(
      Math.min(
        ...Object.values(budgets).map(
          (environment) => environment.portal.max_connections_per_instance,
        ),
      ),
    );
  });

  it("rejects a hosted project with no budget", () => {
    expect(() =>
      resolvePortalBudget(
        "postgresql://postgres.aaaaaaaaaaaaaaaaaaaa:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
      ),
    ).toThrow("no entry in pool-budgets.json");
  });

  it("only ever routes serverless functions to the transaction pooler", () => {
    for (const environment of Object.values(budgets)) {
      expect(environment.portal.pooler_port).toBe(6543);
    }
  });
});
