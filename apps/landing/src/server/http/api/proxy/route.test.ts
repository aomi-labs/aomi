// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

afterEach(() => vi.unstubAllGlobals());

describe("Landing allowlisted external API proxy", () => {
  it("rejects missing, invalid and unknown targets before fetching", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await GET(new Request("http://localhost/api/proxy"))).status).toBe(
      400,
    );
    expect(
      (await GET(new Request("http://localhost/api/proxy?url=not-a-url")))
        .status,
    ).toBe(403);
    expect(
      (
        await GET(
          new Request(
            "http://localhost/api/proxy?url=https://untrusted.example",
          ),
        )
      ).status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves method/body/upstream error status and strips same-origin headers", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response('{"error":"upstream"}', {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(
      new Request(
        `http://localhost/api/proxy?url=${encodeURIComponent("https://api.cow.fi/api/v1/orders")}`,
        {
          method: "POST",
          headers: {
            cookie: "private=fixture",
            origin: "http://localhost",
            "x-api-key": "target-key",
            "content-type": "application/json",
          },
          body: '{"order":"fixture"}',
        },
      ),
    );
    const [target, init] = fetcher.mock.calls[0]!;
    expect(target).toBe("https://api.cow.fi/api/v1/orders");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"order":"fixture"}');
    expect(new Headers(init?.headers).has("cookie")).toBe(false);
    expect(new Headers(init?.headers).has("origin")).toBe(false);
    expect(new Headers(init?.headers).get("x-api-key")).toBe("target-key");
    expect(response.status).toBe(429);
    expect(response.statusText).toBe("Too Many Requests");
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({ error: "upstream" });
  });

  it("returns the existing 502 failure envelope when the target is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fixture unavailable");
      }),
    );
    const response = await GET(
      new Request(
        "http://localhost/api/proxy?url=https://api.llama.fi/protocols",
      ),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Upstream request failed",
      detail: "Error: fixture unavailable",
    });
  });
});
