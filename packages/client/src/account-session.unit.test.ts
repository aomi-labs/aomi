import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AccountCredentialUnavailableError,
  createAccountBearerProvider,
} from "../src/index";
import type { AccountSessionExchangeResponse } from "../src/index";

// =============================================================================
// Helpers
// =============================================================================

function exchangeResponse(
  overrides: Partial<AccountSessionExchangeResponse> = {},
): AccountSessionExchangeResponse {
  return {
    access_token: "token-A",
    token_type: "Bearer",
    expires_at: 4600, // seconds
    user_id: "user-1",
    ...overrides,
  };
}

function okResponse(body: AccountSessionExchangeResponse) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      bearer: body.access_token,
      expires_at: body.expires_at,
      user_id: body.user_id,
    }),
  } as unknown as Response;
}

function okJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function jwtWithPayload(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

const BASE_URL = "https://api.aomi.dev";

describe("createAccountBearerProvider", () => {
  // Cache logic keys off now(); we inject a controllable clock.
  let nowMs: number;
  const now = () => nowMs;

  beforeEach(() => {
    nowMs = 1_000_000; // 1000s — well before the 4600s default expiry
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches the portal-minted Aomi bearer with the correct contract", async () => {
    const fetchImpl = vi.fn(async () => okResponse(exchangeResponse()));
    const getProviderCredential = vi.fn(async () => ({
      provider: "privy" as const,
      providerToken: "privy-jwt",
    }));

    const provider = createAccountBearerProvider({
      baseUrl: `${BASE_URL}/`, // trailing slash should be trimmed
      getProviderCredential,
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    const token = await provider();
    expect(token).toBe("token-A");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/v1/account/bearer`);
    expect(init).toEqual(
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      }),
    );
    expect(getProviderCredential).not.toHaveBeenCalled();

    provider.dispose();
  });

  it("can opt into backend bearers without fetching provider credentials", async () => {
    const token = jwtWithPayload({
      sub: "aomi-user-1",
      iss: "aomi-bff",
      aud: "aomi-backend",
      role: "user",
      exp: 4600,
    });
    const fetchImpl = vi.fn(async () =>
      okJsonResponse({
        bearer: token,
        expires_at: 4600,
        user_id: "aomi-user-1",
      }),
    );
    const getProviderCredential = vi.fn(async () => ({
      provider: "privy" as const,
      providerToken: "privy-jwt",
    }));

    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      betterAuthToken: {
        baseUrl: "https://portal.aomi.dev",
      },
      getProviderCredential,
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    await expect(provider()).resolves.toBe(token);
    expect(getProviderCredential).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://portal.aomi.dev/v1/account/bearer",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      }),
    );

    provider.dispose();
  });

  it("exchanges a provider credential for a Better Auth session before fetching the bearer again", async () => {
    const token = jwtWithPayload({
      sub: "aomi-user-1",
      iss: "aomi-bff",
      aud: "aomi-backend",
      role: "user",
      exp: 4600,
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce(okJsonResponse({ status: "linked" }))
      .mockResolvedValueOnce(
        okJsonResponse({
          bearer: token,
          expires_at: 4600,
          user_id: "aomi-user-1",
        }),
      );
    const getProviderCredential = vi.fn(async () => ({
      provider: "privy" as const,
      tokenKind: "identity_token",
      providerToken: "privy-jwt",
    }));

    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      betterAuthToken: {
        baseUrl: "https://portal.aomi.dev",
      },
      getProviderCredential,
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    await expect(provider()).resolves.toBe(token);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://portal.aomi.dev/v1/account/bearer",
      expect.any(Object),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://portal.aomi.dev/api/auth/aomi/provider/exchange",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          provider: "privy",
          tokenKind: "identity_token",
          providerToken: "privy-jwt",
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://portal.aomi.dev/v1/account/bearer",
      expect.objectContaining({ method: "GET" }),
    );

    provider.dispose();
  });

  it("can use Better Auth token mode without provider exchange fallback", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));
    const getProviderCredential = vi.fn(async () => ({
      provider: "para" as const,
      tokenKind: "session_jwt",
      providerToken: "para-jwt",
    }));

    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      betterAuthToken: {
        baseUrl: "https://portal.aomi.dev",
        providerExchange: false,
      },
      getProviderCredential,
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    await expect(provider()).resolves.toBeUndefined();
    expect(getProviderCredential).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://portal.aomi.dev/v1/account/bearer",
      expect.objectContaining({ method: "GET" }),
    );

    provider.dispose();
  });

  it("caches the bearer until the refresh window and re-exchanges afterwards", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse(exchangeResponse({ access_token: "token-A" })),
      )
      .mockResolvedValueOnce(
        okResponse(exchangeResponse({ access_token: "token-B" })),
      );
    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      getProviderCredential: async () => ({
        provider: "para",
        providerToken: "para-jwt",
      }),
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    expect(await provider()).toBe("token-A");
    // Within the validity window: served from cache, no new fetch.
    expect(await provider()).toBe("token-A");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Advance past refreshAt (expires_at*1000 - 2min = 4_480_000ms).
    nowMs = 4_500_000;
    expect(await provider()).toBe("token-B");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    provider.dispose();
  });

  it("forceRefresh bypasses a still-valid cache", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse(exchangeResponse({ access_token: "token-A" })),
      )
      .mockResolvedValueOnce(
        okResponse(exchangeResponse({ access_token: "token-B" })),
      );
    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      getProviderCredential: async () => ({
        provider: "privy",
        providerToken: "jwt",
      }),
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    expect(await provider()).toBe("token-A");
    expect(await provider({ forceRefresh: true })).toBe("token-B");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    provider.dispose();
  });

  it("coalesces concurrent calls into a single in-flight exchange", async () => {
    let resolveExchange: (r: Response) => void = () => {};
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveExchange = resolve;
        }),
    );
    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      getProviderCredential: async () => ({
        provider: "para",
        providerToken: "jwt",
      }),
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    const a = provider();
    const b = provider();
    // Wait until the (single) exchange is actually in flight before resolving —
    // exchange() awaits getProviderCredential before calling fetch.
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    resolveExchange(okResponse(exchangeResponse({ access_token: "token-A" })));

    expect(await a).toBe("token-A");
    expect(await b).toBe("token-A");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    provider.dispose();
  });

  it("degrades to no token (undefined) on a non-ok exchange response", async () => {
    // The bearer is optional/additive — a failed exchange must not break the
    // caller's request, so the provider resolves undefined rather than throwing.
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: false,
          status: 401,
          json: async () => ({}),
        }) as unknown as Response,
    );
    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      getProviderCredential: async () => ({
        provider: "privy",
        providerToken: "bad",
      }),
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    await expect(provider()).resolves.toBeUndefined();

    provider.dispose();
  });

  it("degrades to no token when the wallet cannot mint a credential (Para 403)", async () => {
    // Mirrors Para issueJwtAsync() rejecting with 403 "user must verify
    // biometrics or external wallets" before verification is complete.
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));
    const getProviderCredential = vi.fn(async () => {
      throw new Error(
        "ParaApiError: user must verify biometrics or external wallets",
      );
    });
    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      getProviderCredential,
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    await expect(provider()).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(getProviderCredential).toHaveBeenCalledTimes(1);

    provider.dispose();
  });

  it("backs off after a failure and does not re-attempt within the cooldown", async () => {
    const getProviderCredential = vi.fn(async () => {
      throw new Error("403");
    });
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));
    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      getProviderCredential,
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    await expect(provider()).resolves.toBeUndefined();
    // A second passive request shortly after must not re-trigger the credential
    // fetch (otherwise every backend poll would 403 the wallet provider).
    nowMs += 1_000;
    await expect(provider()).resolves.toBeUndefined();
    expect(getProviderCredential).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    provider.dispose();
  });

  it("does not back off when the wallet credential is only temporarily unavailable", async () => {
    let attempt = 0;
    const getProviderCredential = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new AccountCredentialUnavailableError();
      }
      return { provider: "para" as const, providerToken: "ready-now" };
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce(okJsonResponse({ status: "linked" }))
      .mockResolvedValueOnce(
        okResponse(exchangeResponse({ access_token: "token-A" })),
      );
    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      getProviderCredential,
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    await expect(provider()).resolves.toBeUndefined();
    nowMs += 1_000;
    await expect(provider()).resolves.toBe("token-A");
    expect(getProviderCredential).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    provider.dispose();
  });

  it("briefly backs off temporary credential-unavailable errors before retrying", async () => {
    const getProviderCredential = vi.fn(async () => {
      throw new AccountCredentialUnavailableError();
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      getProviderCredential,
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    await expect(provider()).resolves.toBeUndefined();
    nowMs += 100;
    await expect(provider()).resolves.toBeUndefined();
    expect(getProviderCredential).toHaveBeenCalledTimes(1);

    nowMs += 200;
    await expect(provider()).resolves.toBeUndefined();
    expect(getProviderCredential).toHaveBeenCalledTimes(2);

    provider.dispose();
  });

  it("rejects Better Auth token expiries that look like milliseconds", async () => {
    const token = jwtWithPayload({
      sub: "aomi-user-1",
      exp: 4_600_000,
    });
    const fetchImpl = vi.fn(async () =>
      okJsonResponse({
        bearer: token,
        expires_at: 4_600_000_000_000,
        user_id: "aomi-user-1",
      }),
    );
    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      betterAuthToken: {},
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    await expect(provider()).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    provider.dispose();
  });

  it("forceRefresh bypasses the failure backoff (used by the 401 retry path)", async () => {
    let attempt = 0;
    const getProviderCredential = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("403");
      return { provider: "para" as const, providerToken: "now-verified" };
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce(okJsonResponse({ status: "linked" }))
      .mockResolvedValueOnce(
        okResponse(exchangeResponse({ access_token: "token-A" })),
      );
    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      getProviderCredential,
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    await expect(provider()).resolves.toBeUndefined();
    // e.g. an endpoint that needs the bearer returned 401 → wrapper retries.
    await expect(provider({ forceRefresh: true })).resolves.toBe("token-A");
    expect(getProviderCredential).toHaveBeenCalledTimes(2);

    provider.dispose();
  });

  it("forceRefresh also bypasses the failure backoff in Better Auth mode", async () => {
    let attempt = 0;
    const getProviderCredential = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("403");
      return { provider: "para" as const, providerToken: "now-verified" };
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "No active session" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "No active session" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(okJsonResponse({ status: "linked" }))
      .mockResolvedValueOnce(
        okJsonResponse({
          bearer: jwtWithPayload({ sub: "aomi-user", exp: 4_000 }),
          expires_at: 4_000,
        }),
      );
    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      betterAuthToken: {},
      getProviderCredential,
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    await expect(provider()).resolves.toBeUndefined();
    await expect(provider({ forceRefresh: true })).resolves.toBe(
      jwtWithPayload({ sub: "aomi-user", exp: 4_000 }),
    );
    expect(getProviderCredential).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    provider.dispose();
  });

  it("proactively refreshes via the timer and notifies subscribers when the token rotates", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse(exchangeResponse({ access_token: "token-A" })),
      )
      .mockResolvedValueOnce(
        okResponse(exchangeResponse({ access_token: "token-B" })),
      );
    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      getProviderCredential: async () => ({
        provider: "para",
        providerToken: "jwt",
      }),
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    const listener = vi.fn();
    provider.subscribe(listener);

    expect(await provider()).toBe("token-A");

    // scheduleRefresh set a timer for (refreshAt - now) = 3_480_000ms.
    await vi.advanceTimersByTimeAsync(3_480_000);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Token rotated A -> B, so subscribers are notified exactly once.
    expect(listener).toHaveBeenCalledTimes(1);

    provider.dispose();
  });

  it("dispose() clears the refresh timer and detaches subscribers", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => okResponse(exchangeResponse()));
    const provider = createAccountBearerProvider({
      baseUrl: BASE_URL,
      getProviderCredential: async () => ({
        provider: "privy",
        providerToken: "jwt",
      }),
      fetch: fetchImpl as unknown as typeof fetch,
      now,
    });

    const listener = vi.fn();
    provider.subscribe(listener);
    await provider();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    provider.dispose();
    await vi.advanceTimersByTimeAsync(10_000_000);

    // No timer-driven refresh after dispose, and no listener fired.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });
});
