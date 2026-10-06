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
    await api.json("/api/account");
    expect(fetcher).toHaveBeenCalledWith(
      "https://portal.example/api/account",
      expect.objectContaining({ credentials: "omit" }),
    );
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer aomi_wst_test");
  });

  it("keeps ordinary Portal requests same-origin", async () => {
    const fetcher = vi.fn(async () => Response.json({ apps: [] }));
    vi.stubGlobal("fetch", fetcher);
    await createShellTransport().json("/api/account/apps");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/account/apps",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("renews once on an unauthorized response and preserves the mutation body", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ apps: ["across"] }));
    vi.stubGlobal("fetch", fetcher);
    const bearer = vi
      .fn()
      .mockResolvedValueOnce("aomi_wst_old")
      .mockResolvedValueOnce("aomi_wst_new");
    const options = {
      method: "PUT",
      body: JSON.stringify({ apps: ["across"] }),
    };
    await createShellTransport("https://portal.example", bearer).json(
      "/api/account/apps",
      options,
    );
    expect(bearer.mock.calls).toEqual([
      [{ forceRefresh: false }],
      [{ forceRefresh: true }],
    ]);
    expect(fetcher.mock.calls[1][1].body).toBe(options.body);
  });

  it("does not send a request when required sign-in is rejected", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const api = createShellTransport("https://portal.example", async () => {
      throw new Error("Signature rejected");
    });
    await expect(api.json("/api/account")).rejects.toThrow(
      "Signature rejected",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects unrelated destinations before requesting a credential", async () => {
    const bearer = vi.fn(async () => "aomi_wst_test");
    await expect(
      createShellTransport("https://portal.example", bearer).json(
        "https://other.example/api/account",
      ),
    ).rejects.toThrow("Unsupported account API path");
    expect(bearer).not.toHaveBeenCalled();
  });
});
