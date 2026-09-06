import { describe, expect, it, vi } from "vitest";
import { createAomiBackendAccountClient } from "./aomi-backend-client";

describe("createAomiBackendAccountClient", () => {
  it("accepts an empty successful sign-out response", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    const client = createAomiBackendAccountClient({ fetch: fetchImpl });

    await expect(client.signOut()).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/auth/sign-out");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({}),
    });
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/json",
    );
  });

  it("accepts an empty 200 sign-out response", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const client = createAomiBackendAccountClient({ fetch: fetchImpl });

    await expect(client.signOut()).resolves.toBeUndefined();
  });

  it("maps Better Auth APIError messages to account-friendly errors", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ message: "already_linked_to_another_account" }),
    }));
    const client = createAomiBackendAccountClient({
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      client.exchangeProviderCredential(
        {
          provider: "para",
          tokenKind: "session_jwt",
          providerToken: "para-jwt",
        },
        { hasAccount: true },
      ),
    ).rejects.toThrow(
      "This wallet or sign-in method is already linked to another Aomi account.",
    );
  });

  it.each([
    ["wallet", "This wallet address is already linked"],
    ["identity", "This sign-in method is already linked"],
    ["email", "This email is already linked"],
  ])("names the %s that actually collided", async (signalType, expected) => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        message: "already_linked_to_another_account",
        signalType,
      }),
    }));
    const client = createAomiBackendAccountClient({
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      client.exchangeProviderCredential(
        {
          provider: "para",
          tokenKind: "session_jwt",
          providerToken: "para-jwt",
        },
        { hasAccount: false },
      ),
    ).rejects.toThrow(expected);
  });

  it("uses Better Auth's strict SIWE request bodies", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ nonce: "nonce" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createAomiBackendAccountClient({
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await client.createSiweNonce();
    await client.verifySiwe({ message: "message", signature: "signature" });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/auth/siwe/nonce",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({}),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/auth/siwe/verify",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ message: "message", signature: "signature" }),
      }),
    );
  });

  it("uses BetterAuth SIWS endpoints for browser sign-in and linking", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ nonce: "nonce" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const client = createAomiBackendAccountClient({
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await client.createSiwsNonce({
      walletAddress: "SolanaAddress",
      chainId: "solana:devnet",
      intent: "link",
    });
    await client.verifySiws({
      message: "message",
      signature: "signature",
      walletAddress: "SolanaAddress",
      chainId: "solana:devnet",
      intent: "link",
      label: "Phantom 1",
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/auth/siws/nonce",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          walletAddress: "SolanaAddress",
          chainId: "solana:devnet",
          intent: "link",
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/auth/siws/verify",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          message: "message",
          signature: "signature",
          walletAddress: "SolanaAddress",
          chainId: "solana:devnet",
          intent: "link",
          label: "Phantom 1",
        }),
      }),
    );
  });

  it("omits cookies, sends the WST, and retries once with a refreshed token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "invalid_widget_session" }),
      })
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: "user-1" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const getAuthorization = vi.fn(async ({ forceRefresh = false } = {}) =>
      forceRefresh ? "fresh-wst" : "stale-wst",
    );
    const client = createAomiBackendAccountClient({
      fetch: fetchImpl as unknown as typeof fetch,
      auth: { credentials: "omit", getAuthorization },
    });

    await expect(client.getAccount()).resolves.toEqual({
      user: { id: "user-1" },
    });
    expect(getAuthorization).toHaveBeenNthCalledWith(1, {
      forceRefresh: false,
    });
    expect(getAuthorization).toHaveBeenNthCalledWith(2, {
      forceRefresh: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init).toMatchObject({ credentials: "omit" });
    }
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer stale-wst");
    expect(
      new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer fresh-wst");
  });
});
