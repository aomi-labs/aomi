import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerAppMcpResource } from "./app-mcp-resource";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DATABASE_URL", "postgres://test.invalid/aomi");
  vi.stubEnv("BETTER_AUTH_URL", "https://portal.example");
});
afterEach(() => vi.unstubAllEnvs());

describe("registerAppMcpResource", () => {
  it("never touches the database for a resource that is not an app MCP path", async () => {
    const db = { query: vi.fn() };
    for (const resource of [
      "https://portal.example/v1/agent/mcp",
      "https://portal.example/v1/apps/World/mcp",
      "https://portal.example/v1/apps/-x/mcp",
      "https://portal.example/v1/apps/a/b/mcp",
      "https://other.example/v1/apps/world/mcp",
    ])
      expect(await registerAppMcpResource(resource, db)).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("registers only for an active app, with the agent MCP's scopes", async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ label: "World" }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const world = "https://portal.example/v1/apps/world/mcp";
    expect(await registerAppMcpResource(world, db)).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(await registerAppMcpResource(world, db)).toBe(true);
    const [sql, values] = db.query.mock.calls[2]!;
    expect(sql).toMatch(/on conflict \(identifier\) do nothing/);
    expect(values.slice(1, 3)).toEqual([world, "World MCP"]);
    expect(JSON.parse(values[3])).toContain("mcp:agent");
  });
});
