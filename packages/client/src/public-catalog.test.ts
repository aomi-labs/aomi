import { describe, expect, it, vi } from "vitest";
import { AomiClient } from "./client";
describe("public catalog transport", () => {
  it("bypasses account bearer resolution and propagates cancellation", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(["model"]));
    const getAccountBearer = vi.fn().mockResolvedValue("secret-bearer");
    const client = new AomiClient({
      baseUrl: "https://portal.example",
      fetch: fetcher,
      getAccountBearer,
    });
    const signal = new AbortController().signal;
    expect(await client.getPublicCatalog("models", { signal })).toEqual([
      "model",
    ]);
    expect(getAccountBearer).not.toHaveBeenCalled();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(
      "https://portal.example/api/public/catalog/models",
    );
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(new Headers(init.headers).has("x-thread-id")).toBe(false);
    expect(init.signal).toBe(signal);
  });
});
