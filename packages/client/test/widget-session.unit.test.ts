import { describe, expect, it, vi } from "vitest";
import {
  createProviderCredentialAdapter,
  createAccountSessionProvider,
  type AccountAuthAdapter,
} from "../src/widget-session";

describe("createAccountSessionProvider", () => {
  it("exchanges any provider credential without cookies or provider-specific code", async () => {
    const fetchImpl = vi.fn(async (_url, init) =>
      Response.json({
        access_token: "provider-wst",
        expires_at: 2_000_000_000,
        received: init,
      }),
    );
    const adapter = createProviderCredentialAdapter({
      provider: "fake-provider",
      environment: "TEST",
      getSubject: () => "subject-1",
      getCredential: async () => ({
        provider: "fake-provider",
        providerToken: "signed-token",
        keyId: "key-1",
      }),
    });
    const provider = createAccountSessionProvider({
      baseUrl: "https://portal.example",
      adapter,
      fetch: fetchImpl,
      now: () => 1_900_000_000_000,
    });

    await expect(provider()).resolves.toBe("provider-wst");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://portal.example/api/auth/widget/exchange",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        body: JSON.stringify({
          provider: "fake-provider",
          environment: "TEST",
          provider_token: "signed-token",
          key_id: "key-1",
        }),
      }),
    );
  });

  it("stages a JWT credential when the provider SDK has not exposed its subject", async () => {
    const providerToken = [
      "header",
      Buffer.from(JSON.stringify({ sub: "delayed-subject" })).toString(
        "base64url",
      ),
      "signature",
    ].join(".");
    const getCredential = vi.fn().mockResolvedValue({
      provider: "para",
      providerToken,
      keyId: "key-1",
    });
    const fetchImpl = vi.fn(async () =>
      Response.json({
        access_token: "provider-wst",
        expires_at: 2_000_000_000,
      }),
    );
    const adapter = createProviderCredentialAdapter({
      provider: "para",
      environment: "BETA",
      getSubject: () => null,
      getCredential,
    });
    const provider = createAccountSessionProvider({
      baseUrl: "https://portal.example",
      adapter,
      fetch: fetchImpl,
      now: () => 1_900_000_000_000,
    });

    await expect(provider()).resolves.toBe("provider-wst");
    await expect(provider()).resolves.toBe("provider-wst");
    expect(getCredential).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent exchange and refreshes before expiry", async () => {
    let now = 1_900_000_000_000;
    const adapter: AccountAuthAdapter = {
      getFingerprint: () => "subject-1",
      exchange: vi
        .fn()
        .mockResolvedValueOnce({
          accessToken: "first",
          expiresAt: now / 1000 + 120,
        })
        .mockResolvedValueOnce({
          accessToken: "second",
          expiresAt: now / 1000 + 240,
        }),
    };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const provider = createAccountSessionProvider({
      baseUrl: "https://portal.example",
      adapter,
      fetch: fetchImpl,
      now: () => now,
      refreshBeforeExpiryMs: 60_000,
    });

    await expect(
      Promise.all([provider(), provider(), provider()]),
    ).resolves.toEqual(["first", "first", "first"]);
    expect(adapter.exchange).toHaveBeenCalledTimes(1);
    now += 61_000;
    await expect(provider()).resolves.toBe("second");
    expect(adapter.exchange).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://portal.example/api/auth/widget/session",
      expect.objectContaining({ method: "DELETE", credentials: "omit" }),
    );
  });

  it("allows only one forced renewal per fresh token generation", async () => {
    const now = 1_900_000_000_000;
    const adapter: AccountAuthAdapter = {
      getFingerprint: () => "wallet-1",
      exchange: vi
        .fn()
        .mockResolvedValueOnce({
          accessToken: "initial",
          expiresAt: now / 1000 + 1_800,
        })
        .mockResolvedValueOnce({
          accessToken: "forced-once",
          expiresAt: now / 1000 + 1_800,
        }),
    };
    const provider = createAccountSessionProvider({
      baseUrl: "https://portal.example",
      adapter,
      now: () => now,
    });

    await expect(provider()).resolves.toBe("initial");
    await expect(provider({ forceRefresh: true })).resolves.toBe("forced-once");
    await expect(provider({ forceRefresh: true })).resolves.toBe("forced-once");
    await expect(provider({ forceRefresh: true })).resolves.toBe("forced-once");

    expect(adapter.exchange).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a failed forced renewal while the cached token is fresh", async () => {
    const now = 1_900_000_000_000;
    const adapter: AccountAuthAdapter = {
      getFingerprint: () => "wallet-1",
      exchange: vi
        .fn()
        .mockResolvedValueOnce({
          accessToken: "initial",
          expiresAt: now / 1000 + 1_800,
        })
        .mockRejectedValueOnce(new Error("wallet rejected")),
    };
    const provider = createAccountSessionProvider({
      baseUrl: "https://portal.example",
      adapter,
      now: () => now,
    });

    await expect(provider()).resolves.toBe("initial");
    await expect(provider({ forceRefresh: true })).rejects.toThrow(
      "wallet rejected",
    );
    await expect(provider({ forceRefresh: true })).resolves.toBe("initial");
    await expect(provider()).resolves.toBe("initial");

    expect(adapter.exchange).toHaveBeenCalledTimes(2);
  });

  it("clears failed exchanges so a retry can succeed without an unhandled branch", async () => {
    const adapter: AccountAuthAdapter = {
      getFingerprint: () => "subject-1",
      exchange: vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary"))
        .mockResolvedValueOnce({
          accessToken: "recovered",
          expiresAt: 2_000_000_000,
        }),
    };
    const provider = createAccountSessionProvider({
      baseUrl: "https://portal.example",
      adapter,
      now: () => 1_900_000_000_000,
    });

    await expect(provider()).rejects.toThrow("temporary");
    await expect(provider()).resolves.toBe("recovered");
  });

  it("discards an exchange that resolves after signOut so the session does not survive sign-out", async () => {
    const T = 1_900_000_000_000;
    const gate = deferred<{ accessToken: string; expiresAt: number }>();
    const adapter: AccountAuthAdapter = {
      getFingerprint: () => "subject-1",
      exchange: vi.fn(() => gate.promise),
      signOut: vi.fn(async () => undefined),
    };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const provider = createAccountSessionProvider({
      baseUrl: "https://portal.example",
      adapter,
      fetch: fetchImpl,
      now: () => T,
    });
    const listener = vi.fn();
    provider.subscribe(listener);

    const inflight = provider();
    await vi.waitFor(() => expect(adapter.exchange).toHaveBeenCalledTimes(1));

    // Sign out while the exchange is still in flight. This bumps the generation
    // and notifies subscribers so the live stream tears down immediately.
    await provider.signOut();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(adapter.signOut).toHaveBeenCalledOnce();

    // The pre-signOut exchange now resolves. Its server-side token is revoked
    // and the waiting caller is rejected, so no request can continue after the
    // explicit sign-out.
    gate.resolve({ accessToken: "post-signout", expiresAt: T / 1000 + 120 });
    await expect(inflight).rejects.toThrow("superseded");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://portal.example/api/auth/widget/session",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer post-signout" },
      }),
    );

    // A fresh request must run a brand-new exchange rather than reuse the
    // discarded token.
    const second = deferred<{ accessToken: string; expiresAt: number }>();
    (adapter.exchange as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => second.promise,
    );
    const next = provider();
    await vi.waitFor(() => expect(adapter.exchange).toHaveBeenCalledTimes(2));
    second.resolve({ accessToken: "fresh", expiresAt: T / 1000 + 120 });
    await expect(next).resolves.toBe("fresh");
  });

  it("does not overwrite the cache when an older-fingerprint exchange resolves last", async () => {
    const T = 1_900_000_000_000;
    const dA = deferred<{ accessToken: string; expiresAt: number }>();
    const dB = deferred<{ accessToken: string; expiresAt: number }>();
    let fingerprint = "wallet-A";
    const exchange = vi
      .fn()
      .mockImplementationOnce(() => dA.promise)
      .mockImplementationOnce(() => dB.promise);
    const adapter: AccountAuthAdapter = {
      getFingerprint: () => fingerprint,
      exchange,
    };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const provider = createAccountSessionProvider({
      baseUrl: "https://portal.example",
      adapter,
      fetch: fetchImpl,
      now: () => T,
    });

    const pA = provider();
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(1));
    fingerprint = "wallet-B";
    const pB = provider();
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(2));

    // Newer identity (wallet-B) resolves first and is cached.
    dB.resolve({ accessToken: "token-B", expiresAt: T / 1000 + 120 });
    await expect(pB).resolves.toBe("token-B");
    // Older identity (wallet-A) resolves last; its token is revoked and the
    // waiting caller is rejected rather than executing as the stale wallet.
    dA.resolve({ accessToken: "token-A", expiresAt: T / 1000 + 120 });
    await expect(pA).rejects.toThrow("superseded");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://portal.example/api/auth/widget/session",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer token-A" },
      }),
    );

    // The cache still belongs to the current identity (wallet-B) and serves it
    // without a third exchange.
    await expect(provider()).resolves.toBe("token-B");
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it("throws after dispose and notifies subscribers on every teardown", async () => {
    const adapter: AccountAuthAdapter = {
      getFingerprint: () => "subject-1",
      exchange: vi.fn(async () => ({
        accessToken: "tok",
        expiresAt: 2_000_000_000,
      })),
    };
    const provider = createAccountSessionProvider({
      baseUrl: "https://portal.example",
      adapter,
      now: () => 1_900_000_000_000,
    });
    const listener = vi.fn();
    provider.subscribe(listener);

    await expect(provider()).resolves.toBe("tok");
    expect(listener).toHaveBeenCalledTimes(1); // cache populated

    provider.dispose();
    expect(listener).toHaveBeenCalledTimes(2); // terminal notify

    await expect(provider()).rejects.toThrow("disposed");
  });

  it("notifies subscribers and revokes the cached session on revoke", async () => {
    const T = 1_900_000_000_000;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const adapter: AccountAuthAdapter = {
      getFingerprint: () => "subject-1",
      exchange: vi.fn(async () => ({
        accessToken: "tok",
        expiresAt: T / 1000 + 120,
      })),
    };
    const provider = createAccountSessionProvider({
      baseUrl: "https://portal.example",
      adapter,
      fetch: fetchImpl,
      now: () => T,
    });
    const listener = vi.fn();
    provider.subscribe(listener);

    await provider();
    await provider.revoke();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://portal.example/api/auth/widget/session",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer tok" },
      }),
    );
  });

  it("exposes `required` as an enumerable property that survives spreading", async () => {
    const adapter: AccountAuthAdapter = {
      getFingerprint: () => "subject-1",
      exchange: vi.fn(async () => ({
        accessToken: "tok",
        expiresAt: 2_000_000_000,
      })),
    };
    const provider = createAccountSessionProvider({
      baseUrl: "https://portal.example",
      adapter,
      now: () => 1,
    });
    expect(provider.required).toBe(true);
    expect({ ...provider }.required).toBe(true);
  });

  it("rejects a widget session whose expires_at is a millisecond timestamp", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ access_token: "tok", expires_at: 2_000_000_000_000 }),
    );
    const adapter = createProviderCredentialAdapter({
      provider: "fake-provider",
      environment: "TEST",
      getSubject: () => "subject-1",
      getCredential: async () => ({
        provider: "fake-provider",
        providerToken: "signed-token",
      }),
    });
    const provider = createAccountSessionProvider({
      baseUrl: "https://portal.example",
      adapter,
      fetch: fetchImpl,
      now: () => 1,
    });
    await expect(provider()).rejects.toThrow("seconds, not ms");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
