import { afterEach, describe, expect, it, vi } from "vitest";

import { wrapFetchWithPublicApiAuthorization } from "../src/client";
import { createGuestSessionProvider } from "../src/guest-auth";
import type { AomiOAuthTokenRequest } from "../src/authorization";

afterEach(() => vi.unstubAllGlobals());

describe("public API OAuth transport", () => {
  it("requests the exact Agent resource and route scope", async () => {
    const upstream = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer agent-token",
        );
        return new Response("{}", { status: 200 });
      },
    );
    const oauth = vi.fn(async (request: AomiOAuthTokenRequest) => ({
      accessToken: "agent-token",
      expiresAt: Date.now() + 60_000,
      resource: request.resource,
      scopes: request.scopes,
    }));
    const authorized = wrapFetchWithPublicApiAuthorization({
      fetch: upstream as typeof fetch,
      baseUrl: "https://chat.aomi.dev",
      oauth,
    });

    await authorized("https://chat.aomi.dev/v1/agent/sessions", {
      method: "GET",
    });

    expect(oauth).toHaveBeenCalledWith({
      resource: "https://chat.aomi.dev/v1/agent",
      scopes: ["agent:read"],
      forceRefresh: false,
    });
  });

  it("authorizes the exact public API roots", async () => {
    const upstream = vi.fn(async () => new Response("{}", { status: 200 }));
    const oauth = vi.fn(async (request: AomiOAuthTokenRequest) => ({
      accessToken: "root-token",
      expiresAt: Date.now() + 60_000,
      resource: request.resource,
      scopes: request.scopes,
    }));
    const authorized = wrapFetchWithPublicApiAuthorization({
      fetch: upstream as typeof fetch,
      baseUrl: "https://chat.aomi.dev",
      oauth,
    });

    await authorized("https://chat.aomi.dev/v1/agent", { method: "GET" });
    await authorized("https://chat.aomi.dev/v1/pipeline", { method: "GET" });

    expect(oauth).toHaveBeenNthCalledWith(1, {
      resource: "https://chat.aomi.dev/v1/agent",
      scopes: ["agent:read"],
      forceRefresh: false,
    });
    expect(oauth).toHaveBeenNthCalledWith(2, {
      resource: "https://chat.aomi.dev/v1/pipeline",
      scopes: ["pipeline:catalog"],
      forceRefresh: false,
    });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("requests exact Credit Bank scopes and steps up signed top-ups", async () => {
    const upstream = vi.fn(async () => new Response("{}", { status: 200 }));
    const oauth = vi.fn(async (request: AomiOAuthTokenRequest) => ({
      accessToken: "account-token",
      expiresAt: Date.now() + 60_000,
      resource: request.resource,
      scopes: request.scopes,
    }));
    const authorized = wrapFetchWithPublicApiAuthorization({
      fetch: upstream as typeof fetch,
      baseUrl: "https://chat.aomi.dev",
      oauth,
    });

    await authorized("https://chat.aomi.dev/v1/account/credits");
    await authorized("https://chat.aomi.dev/v1/account/statement");
    await authorized("https://chat.aomi.dev/v1/account/credits/top-up", {
      method: "POST",
      headers: { "payment-signature": "signed" },
    });

    expect(oauth).toHaveBeenNthCalledWith(1, {
      resource: "https://chat.aomi.dev/v1/account",
      scopes: ["account:credits:read"],
      forceRefresh: false,
    });
    expect(oauth).toHaveBeenNthCalledWith(2, {
      resource: "https://chat.aomi.dev/v1/account",
      scopes: ["account:usage:read"],
      forceRefresh: false,
    });
    expect(oauth).toHaveBeenNthCalledWith(3, {
      resource: "https://chat.aomi.dev/v1/account",
      scopes: ["account:credits:topup", "payments:submit"],
      forceRefresh: false,
    });
  });

  it("retries once with a refreshed token after a token failure", async () => {
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const oauth = vi.fn(async (request: AomiOAuthTokenRequest) => ({
      accessToken: request.forceRefresh ? "fresh" : "stale",
      expiresAt: Date.now() + 60_000,
      resource: request.resource,
      scopes: request.scopes,
    }));
    const authorized = wrapFetchWithPublicApiAuthorization({
      fetch: upstream as typeof fetch,
      baseUrl: "https://chat.aomi.dev",
      oauth,
    });

    expect(
      (
        await authorized("https://chat.aomi.dev/v1/pipeline/tool-calls", {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(oauth).toHaveBeenLastCalledWith(
      expect.objectContaining({ forceRefresh: true }),
    );
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("answers a DPoP nonce challenge with a newly signed proof", async () => {
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          headers: { "dpop-nonce": "nonce-1" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const dpopProof = vi.fn(
      async ({ nonce }: { nonce?: string }) => `proof:${nonce ?? "initial"}`,
    );
    const oauth = vi.fn(async (request: AomiOAuthTokenRequest) => ({
      accessToken: "dpop-token",
      expiresAt: Date.now() + 60_000,
      resource: request.resource,
      scopes: request.scopes,
      tokenType: "DPoP" as const,
      dpopProof,
    }));
    const authorized = wrapFetchWithPublicApiAuthorization({
      fetch: upstream as typeof fetch,
      baseUrl: "https://chat.aomi.dev",
      oauth,
    });

    await authorized("https://chat.aomi.dev/v1/agent/chat", {
      method: "POST",
    });

    expect(dpopProof).toHaveBeenCalledTimes(2);
    expect(dpopProof).toHaveBeenLastCalledWith(
      expect.objectContaining({ nonce: "nonce-1" }),
    );
    expect(oauth).toHaveBeenLastCalledWith(
      expect.objectContaining({ forceRefresh: false }),
    );
  });
});

describe("Better Auth guest bootstrap", () => {
  it("uses the opaque Better Auth session as a bearer in server runtimes", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("location", undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(Response.json({ token: "server-guest-session" }));
    const guest = createGuestSessionProvider({
      baseUrl: "https://portal.example",
      fetch: fetchImpl as typeof fetch,
    });

    await expect(guest()).resolves.toBe("server-guest-session");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://portal.example/api/auth/sign-in/anonymous",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("accepts Better Auth's session response header in server runtimes", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("location", undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { user: { id: "guest" } },
          { headers: { "set-auth-token": "header-guest-session" } },
        ),
      );
    const guest = createGuestSessionProvider({
      baseUrl: "https://portal.example",
      fetch: fetchImpl as typeof fetch,
    });

    await expect(guest()).resolves.toBe("header-guest-session");
  });

  it("uses the origin-bound widget guest route without credentialed CORS", async () => {
    vi.stubGlobal("location", { origin: "https://widget.example" });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        Response.json({ access_token: "aomi_wst_widget_guest" }),
      );
    const guest = createGuestSessionProvider({
      baseUrl: "https://portal.example",
      fetch: fetchImpl as typeof fetch,
    });

    await expect(guest()).resolves.toBe("aomi_wst_widget_guest");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://portal.example/api/auth/widget/guest",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("uses the existing same-origin session without probing or creating a guest", async () => {
    vi.stubGlobal("location", { origin: "https://chat.aomi.dev" });
    const fetchImpl = vi.fn();
    const guest = createGuestSessionProvider({
      baseUrl: "https://chat.aomi.dev",
      fetch: fetchImpl as typeof fetch,
    });

    await expect(guest()).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not replace a signed-in session during forced guest acquisition", async () => {
    vi.stubGlobal("location", { origin: "https://chat.aomi.dev" });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        Response.json({ code: "session_exists" }, { status: 409 }),
      );
    const guest = createGuestSessionProvider({
      baseUrl: "https://chat.aomi.dev",
      fetch: fetchImpl as typeof fetch,
    });

    await expect(guest({ forceRefresh: true })).resolves.toBeNull();
    await expect(guest()).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "/api/auth/sign-in/anonymous",
    );
  });

  it("falls back to the anonymous cookie when Better Auth refuses a second anonymous sign-in", async () => {
    vi.stubGlobal("location", { origin: "https://chat.aomi.dev" });
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json(
        {
          code: "ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY",
          message: "Anonymous users cannot sign in again anonymously",
        },
        { status: 400 },
      ),
    );
    const guest = createGuestSessionProvider({
      baseUrl: "https://chat.aomi.dev",
      fetch: fetchImpl as typeof fetch,
    });

    // The live anonymous cookie IS a working credential; the refusal must
    // not fail the caller's request, and the null result is cached so the
    // provider does not re-POST on every call.
    await expect(guest({ forceRefresh: true })).resolves.toBeNull();
    await expect(guest()).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a same-origin 401 after establishing the guest cookie", async () => {
    vi.stubGlobal("location", { origin: "https://chat.aomi.dev" });
    const authFetch = vi.fn().mockResolvedValue(Response.json({}));
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const guest = createGuestSessionProvider({
      baseUrl: "https://chat.aomi.dev",
      fetch: authFetch as typeof fetch,
    });
    const authorized = wrapFetchWithPublicApiAuthorization({
      fetch: upstream as typeof fetch,
      baseUrl: "https://chat.aomi.dev",
      guest,
    });

    expect(
      (await authorized("https://chat.aomi.dev/v1/agent/sessions")).status,
    ).toBe(200);
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(String(authFetch.mock.calls[0]?.[0])).toContain(
      "/api/auth/sign-in/anonymous",
    );
    expect(upstream).toHaveBeenCalledTimes(2);
    for (const [, init] of upstream.mock.calls) {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
    }
  });

  it("fails closed when anonymous session establishment is unavailable", async () => {
    vi.stubGlobal("location", { origin: "https://chat.aomi.dev" });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const guest = createGuestSessionProvider({
      baseUrl: "https://chat.aomi.dev",
      fetch: fetchImpl as typeof fetch,
    });

    await expect(guest({ forceRefresh: true })).rejects.toThrow(
      "Aomi guest sign-in failed with HTTP 503",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "/api/auth/sign-in/anonymous",
    );
  });
});
