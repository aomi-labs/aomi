// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyMintlify } from "./mintlify-proxy";

afterEach(() => vi.unstubAllGlobals());

describe("Landing Mintlify proxy", () => {
  it("keeps encoded queries, streams, status and response policy", async () => {
    const bytes = new TextEncoder().encode("event: update\ndata: docs\n\n");
    const stream = new ReadableStream({
      start: (controller) => {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(stream, {
          status: 206,
          statusText: "Partial Content",
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            "content-security-policy": "default-src 'self'",
            "content-encoding": "gzip",
            "content-length": "100",
          },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const response = await proxyMintlify(
      new Request(
        "http://localhost:3000/docs/build.md?filter=a%2Fb&filter=x+y",
      ),
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://aomilabs.mintlify.dev/docs/build.md?filter=a%2Fb&filter=x+y",
    );
    expect(response.status).toBe(206);
    expect(response.statusText).toBe("Partial Content");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'self'",
    );
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(response.headers.has("content-length")).toBe(false);
    expect(response.body).toBe(stream);
    expect(await response.text()).toBe(new TextDecoder().decode(bytes));
  });

  it("bridges the docs API method, body and headers to its fixed host", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ ok: true }),
    );
    vi.stubGlobal("fetch", fetcher);
    const request = new Request("http://localhost:3000/api/request?q=docs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-docs-test": "fixture",
        host: "localhost:3000",
      },
      body: '{"query":"build"}',
    });
    await proxyMintlify(request);
    const [target, init] = fetcher.mock.calls[0]!;
    expect(String(target)).toBe(
      "https://aomilabs.mintlify.dev/_mintlify/api/request?q=docs",
    );
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(request.body);
    expect(init?.signal).toBe(request.signal);
    expect(new Headers(init?.headers).get("x-docs-test")).toBe("fixture");
    expect(new Headers(init?.headers).has("host")).toBe(false);
    expect(init?.redirect).toBe("manual");
  });

  it("keeps same-host redirects on the Landing origin and HEAD bodyless", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("upstream body", {
            status: 307,
            headers: {
              location:
                "https://aomilabs.mintlify.dev/docs/build?tab=api#install",
            },
          }),
      ),
    );
    const response = await proxyMintlify(
      new Request("http://localhost/docs", { method: "HEAD" }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "/docs/build?tab=api#install",
    );
    expect(response.body).toBeNull();
  });

  it("never proxies paths outside the docs routes", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await proxyMintlify(
      new Request("http://localhost/api/account"),
    );
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
