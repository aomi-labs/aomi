import { afterEach, describe, expect, it, vi } from "vitest";
import { createShellTransport } from "./transport";

afterEach(() => vi.unstubAllGlobals());

describe("shared account transport", () => {
  it("uses the configured Portal and wallet credential, never the embedding site's cookies", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ user: { user_id: "account-a" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    const bearer = vi.fn(async () => "aomi_wst_test");
    const api = createShellTransport("https://portal.example/", bearer);
    await api.aomi.raw.getAccount("t");
    expect(fetcher).toHaveBeenCalledWith(
      "https://portal.example/api/account",
      expect.objectContaining({ credentials: "omit" }),
    );
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer aomi_wst_test");
  });

  it("keeps ordinary Portal requests same-origin", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ apps: [] }),
    );
    vi.stubGlobal("fetch", fetcher);
    await createShellTransport().aomi.account.apps.list();
    expect(fetcher).toHaveBeenCalledWith(
      "/v1/account/apps",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("renews once on an unauthorized response and preserves the mutation body", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({
          mode: "balanced",
          revision: 2,
          scope: "thread",
          source: "user",
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const bearer = vi
      .fn()
      .mockResolvedValueOnce("aomi_wst_old")
      .mockResolvedValueOnce("aomi_wst_new");
    const { guard } = createShellTransport("https://portal.example", bearer)
      .aomi.account;
    await guard.set({ mode: "balanced", thread: "t", revision: 1 });
    expect(bearer.mock.calls).toEqual([
      [{ forceRefresh: false }],
      [{ forceRefresh: true }],
    ]);
    const body = JSON.stringify({ mode: "balanced", expectedRevision: 1 });
    expect(fetcher.mock.calls[0][1].body).toBe(body);
    expect(fetcher.mock.calls[1][1].body).toBe(body);
  });

  it("does not send a request when required sign-in is rejected", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const api = createShellTransport("https://portal.example", async () => {
      throw new Error("Signature rejected");
    });
    await expect(api.aomi.raw.getAccount("t")).rejects.toThrow(
      "Signature rejected",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it("validates a private key through thread discovery without requiring an account credential", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json([]),
  );
  vi.stubGlobal("fetch", fetch);
  const getBearer = vi.fn(async () => {
    throw new Error("No account credential");
  });
  const transport = createShellTransport("https://api.example", getBearer);
  await expect(
    transport.aomi.raw.resolveAppKey("disposable-key"),
  ).resolves.toEqual([]);
  expect(getBearer).not.toHaveBeenCalled();
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get("aomi-app-key")).toBe(
    "disposable-key",
  );
});
