// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("Landing brand brief", () => {
  it("reuses a successful public brief for an hour and refreshes afterwards", async () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetcher = vi.fn(async () => new Response(`# Brief ${now}`));
    vi.stubGlobal("fetch", fetcher);
    const { GET } = await import("./brand-md");
    const first = await GET();
    expect(await first.text()).toBe("# Brief 10000");
    expect(first.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(first.headers.get("cache-control")).toContain("s-maxage=3600");
    now += 3_599_999;
    expect(await (await GET()).text()).toBe("# Brief 10000");
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await (await GET()).text()).toBe("# Brief 10000");
    await vi.waitFor(async () => {
      expect(await (await GET()).text()).toBe(`# Brief ${now}`);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("serves real fallback positioning on failure and retries the upstream", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("# Recovered"));
    vi.stubGlobal("fetch", fetcher);
    const { GET } = await import("./brand-md");
    const fallback = await GET();
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toContain(
      "Aomi Labs builds the native harness on blockchains.",
    );
    expect(await (await GET()).text()).toBe("# Recovered");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
