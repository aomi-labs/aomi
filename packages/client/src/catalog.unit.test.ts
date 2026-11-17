import { expect, it, vi } from "vitest";
import { AomiClient } from "./client";

it("reads effective package state with account and thread credentials", async () => {
  const catalog = {
    toolsets: [{ name: "default", display_name: "Default" }],
    packages: [{ package_id: 3, id: "aomi/reader", enabled: true }],
  };
  const fetch = vi.fn(async () => Response.json(catalog));
  const client = new AomiClient({
    baseUrl: "https://portal.test",
    guest: false,
    getAccountBearer: async () => "account-fixture",
    fetch,
  });
  expect(await client.listCatalog("thread-fixture")).toEqual(catalog);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://portal.test/api/thread/catalog");
  expect(new Headers(init.headers).get("authorization")).toBe(
    "Bearer account-fixture",
  );
  expect(new Headers(init.headers).get("x-thread-id")).toBe("thread-fixture");
});

it("resolves one agent by its explicit key without ambient account credentials", async () => {
  const card = {
    agent_id: 7,
    agent: "alice/reader",
    display_name: "Reader",
    metadata: {},
  };
  const fetch = vi.fn(async () => Response.json(card));
  const client = new AomiClient({
    baseUrl: "https://portal.test",
    getAccountBearer: async () => "ambient-fixture",
    fetch,
  });
  expect(await client.resolveAgentKey("key-fixture")).toEqual(card);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://portal.test/api/agents/resolve");
  expect(new Headers(init.headers).get("aomi-agent-key")).toBe("key-fixture");
  expect(new Headers(init.headers).has("authorization")).toBe(false);
});
