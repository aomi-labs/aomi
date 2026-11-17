import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerAgentMcpResource } from "./agent-mcp-resource";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DATABASE_URL", "postgres://test.invalid/aomi");
  vi.stubEnv("BETTER_AUTH_URL", "https://portal.example");
});
afterEach(() => vi.unstubAllEnvs());

describe("registerAgentMcpResource", () => {
  it("never touches the database for a resource that is not an agent MCP path", async () => {
    const db = { query: vi.fn() };
    for (const resource of [
      "https://portal.example/v1/agent/mcp",
      "https://portal.example/v1/agents/World/mcp",
      "https://portal.example/v1/agents/aomi%2F-x/mcp",
      "https://portal.example/v1/agents/a/b/mcp",
      "https://other.example/v1/agents/aomi%2Fworld/mcp",
    ])
      expect(await registerAgentMcpResource(resource, db)).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("registers only for an active agent, with the agent MCP's scopes", async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ label: "World" }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const world = "https://portal.example/v1/agents/aomi%2Fworld/mcp";
    expect(await registerAgentMcpResource(world, db)).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(await registerAgentMcpResource(world, db)).toBe(true);
    const [sql, values] = db.query.mock.calls[2]!;
    expect(sql).toMatch(/on conflict \(identifier\) do nothing/);
    expect(values.slice(1, 3)).toEqual([world, "World MCP"]);
    expect(JSON.parse(values[3])).toContain("mcp:agent");
  });
});
