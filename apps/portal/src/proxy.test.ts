import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("local hosted Portal transport", () => {
  it("is inactive in deployed builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_AOMI_HOSTED_PORTAL_URL", "https://staging.example");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await proxy(new NextRequest("https://local.example/api/account"));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("forwards the caller bearer and origin, strips cookies, and exposes the response", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_AOMI_HOSTED_PORTAL_URL", "https://staging.example");
    const fetcher = vi.fn(async (_url: URL, _options?: RequestInit) =>
      Response.json(
        { entries: [] },
        { headers: { "Set-Cookie": "upstream=private" } },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const response = await proxy(
      new NextRequest("https://local.example/v1/account/statement?limit=10", {
        headers: {
          Origin: "https://embed.example",
          Authorization: "Bearer test-wst",
          Cookie: "unrelated=private",
        },
      }),
    );
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://staging.example/v1/account/statement?limit=10",
    );
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-wst");
    expect(headers.get("origin")).toBe("https://embed.example");
    expect(headers.get("cookie")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://embed.example",
    );
  });
});
