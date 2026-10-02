import { describe, expect, it, vi } from "vitest";
import { createPortalOriginFetch } from "./portal-origin-fetch";

describe("headless widget origin transport", () => {
  it("binds same-origin SIWS and Agent calls to the Portal Origin", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const boundFetch = createPortalOriginFetch(
      "https://chat-staging.aomi.dev",
      fetchImpl as typeof fetch,
    );
    await boundFetch(
      "https://chat-staging.aomi.dev/api/auth/widget/siws/nonce",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
      },
    );
    const init = (fetchImpl.mock.calls as unknown[][])[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("origin")).toBe(
      "https://chat-staging.aomi.dev",
    );
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json",
    );
  });

  it("leaves unrelated destinations untouched", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const boundFetch = createPortalOriginFetch(
      "https://chat-staging.aomi.dev",
      fetchImpl as typeof fetch,
    );
    const init = { method: "GET" };
    await boundFetch("https://other.example/api", init);
    expect(fetchImpl).toHaveBeenCalledWith("https://other.example/api", init);
  });
});
