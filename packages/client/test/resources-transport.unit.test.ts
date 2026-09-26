import { describe, expect, it, vi } from "vitest";
import { AgentApiError, AomiClient } from "../src";

const uri = "aomi://main/results/00000000000000000000000000000001";

describe("authorized resource transport", () => {
  it("keeps exact URIs, bounded pagination and thread context on uncached reads", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ resources: [], next_cursor: "next" }),
      );
    const resources = new AomiClient({
      baseUrl: "https://portal.example",
      fetch,
      guest: false,
    }).agent.resources;
    await resources.list("thread/a", {
      kind: "data.json@1",
      cursor: "previous",
      limit: 3,
    });
    const controller = new AbortController();
    await resources.read("thread/a", uri, {
      view: "content",
      cursor: "part:2",
      limit: 128,
      signal: controller.signal,
    });
    const [url, options] = fetch.mock.calls[1];
    const read = new URL(url);
    expect(read.pathname).toBe("/v1/agent/sessions/thread%2Fa/resources/read");
    expect(Object.fromEntries(read.searchParams)).toEqual({
      uri,
      view: "content",
      cursor: "part:2",
      limit: "128",
    });
    expect(new Headers(options.headers).get("x-thread-id")).toBe("thread/a");
    expect(options.cache).toBe("no-store");
    expect(options.signal).toBe(controller.signal);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("limit")).toBe("3");
  });

  it("requests the exact Agent read grant and never a Pipeline grant", async () => {
    const oauth = vi.fn().mockResolvedValue({
      resource: "https://portal.example/v1/agent",
      scopes: ["agent:read"],
      accessToken: "resource-token",
    });
    const fetch = vi.fn().mockResolvedValue(Response.json({ resources: [] }));
    const resources = new AomiClient({
      baseUrl: "https://portal.example",
      fetch,
      guest: false,
      oauth,
    }).agent.resources;
    await resources.list("thread");
    expect(oauth).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: "https://portal.example/v1/agent",
        scopes: ["agent:read"],
      }),
    );
    expect(
      new Headers(fetch.mock.calls[0][1].headers).get("authorization"),
    ).toBe("Bearer resource-token");
  });

  it.each([
    [404, "resource_not_found"],
    [410, "resource_gone"],
    [403, "resource_scope_mismatch"],
    [503, "resource_unavailable"],
  ])(
    "keeps resource rejection %s/%s without fabricating content",
    async (status, code) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { code } }, { status: Number(status) }),
        );
      const resources = new AomiClient({
        baseUrl: "https://portal.example",
        fetch,
        guest: false,
      }).agent.resources;
      await expect(resources.read("thread", uri)).rejects.toMatchObject({
        name: AgentApiError.name,
        status,
        code,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});
