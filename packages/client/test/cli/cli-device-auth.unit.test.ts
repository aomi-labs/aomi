import { describe, expect, it, vi } from "vitest";

import {
  buildDeviceAuthUrl,
  getDeviceProviderCredential,
  signInWithDeviceProvider,
} from "../../src/cli/device-auth";

describe("CLI device provider auth", () => {
  it("builds the provider auth URL with PKCE and loopback redirect", () => {
    const url = buildDeviceAuthUrl({
      portalUrl: "https://chat.aomi.dev",
      state: "state-123",
      codeChallenge: "challenge-123",
      redirectUri: "http://127.0.0.1:12345/callback",
      provider: "privy",
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://chat.aomi.dev");
    expect(parsed.pathname).toBe("/device-auth");
    expect(parsed.searchParams.get("state")).toBe("state-123");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-123");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:12345/callback",
    );
    expect(parsed.searchParams.get("provider")).toBe("privy");
  });

  it("builds provider link URLs with link mode", () => {
    const url = buildDeviceAuthUrl({
      portalUrl: "https://chat.aomi.dev",
      state: "state-123",
      codeChallenge: "challenge-123",
      redirectUri: "http://127.0.0.1:12345/callback",
      provider: "para",
      mode: "link",
      linkIntent: "intent-123",
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get("provider")).toBe("para");
    expect(parsed.searchParams.get("mode")).toBe("link");
    expect(parsed.searchParams.get("link_intent")).toBe("intent-123");
  });

  it("canonicalizes the raw staging API before provider login", async () => {
    const originalFetch = globalThis.fetch;
    const exchangeFetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        if (target.startsWith("http://127.0.0.1:")) {
          return originalFetch(url, init);
        }
        if (
          target ===
          "https://chat-staging.aomi.dev/v1/account/device-auth/exchange"
        ) {
          const body = JSON.parse(String(init?.body));
          expect(body.code).toBe("grant-code");
          expect(body.state).toMatch(/^[A-Za-z0-9_-]+$/);
          expect(body.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
          expect(body.redirectUri).toMatch(
            /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
          );
          return Response.json({
            sessionToken: "better-auth-session",
            expiresAt: "2032-03-04T05:06:07.000Z",
            betterAuthUserId: "ba-user",
            provider: "para",
          });
        }
        if (target === "https://chat-staging.aomi.dev/v1/account") {
          expect(new Headers(init?.headers).get("Authorization")).toBe(
            "Bearer better-auth-session",
          );
          return Response.json({
            session: {
              betterAuthUserId: "ba-user",
              expiresAt: "2032-03-04T05:06:07.000Z",
            },
          });
        }
        throw new Error(`unexpected fetch: ${target}`);
      },
    );
    vi.stubGlobal("fetch", exchangeFetch);

    try {
      const result = await signInWithDeviceProvider({
        baseUrl: "https://api-staging.aomi.dev",
        provider: "para",
        openBrowser: async (url) => {
          const parsed = new URL(url);
          expect(parsed.origin).toBe("https://chat-staging.aomi.dev");
          expect(parsed.searchParams.get("provider")).toBe("para");
          const redirectUri = parsed.searchParams.get("redirect_uri");
          const state = parsed.searchParams.get("state");
          expect(redirectUri).toBeTruthy();
          expect(state).toBeTruthy();
          await originalFetch(
            `${redirectUri}?code=grant-code&state=${encodeURIComponent(
              state ?? "",
            )}`,
          );
        },
        timeoutMs: 5_000,
      });

      expect(result.provider).toBe("para");
      expect(result.auth).toEqual({
        sessionToken: "better-auth-session",
        expiresAt: Date.parse("2032-03-04T05:06:07.000Z"),
        betterAuthUserId: "ba-user",
      });
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("links provider credentials through a portal PKCE code exchange", async () => {
    const originalFetch = globalThis.fetch;
    const exchangeFetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        if (target.startsWith("http://127.0.0.1:")) {
          return originalFetch(url, init);
        }
        if (
          target === "https://chat.aomi.dev/v1/account/device-auth/link-intent"
        ) {
          const body = JSON.parse(String(init?.body));
          expect(new Headers(init?.headers).get("Authorization")).toBe(
            "Bearer current-session",
          );
          expect(body.state).toMatch(/^[A-Za-z0-9_-]+$/);
          expect(body.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
          expect(body.redirectUri).toMatch(
            /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
          );
          expect(body.provider).toBe("privy");
          return Response.json({
            linkIntent: "link-intent-123",
            state: body.state,
            redirectUri: body.redirectUri,
            provider: "privy",
          });
        }
        if (
          target === "https://chat.aomi.dev/v1/account/device-auth/exchange"
        ) {
          const body = JSON.parse(String(init?.body));
          expect(body.code).toBe("link-grant-code");
          expect(body.state).toMatch(/^[A-Za-z0-9_-]+$/);
          expect(body.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
          expect(body.redirectUri).toMatch(
            /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
          );
          return Response.json({
            status: "linked",
            provider: "privy",
            account: {
              user: { id: "aomi-user-1" },
              linkedAccounts: [],
              wallets: [],
              session: { betterAuthUserId: "ba-user" },
            },
          });
        }
        throw new Error(`unexpected fetch: ${target}`);
      },
    );
    vi.stubGlobal("fetch", exchangeFetch);

    try {
      const result = await getDeviceProviderCredential({
        baseUrl: "https://api.aomi.dev",
        provider: "privy",
        sessionToken: "current-session",
        openBrowser: async (url) => {
          const parsed = new URL(url);
          expect(parsed.searchParams.get("provider")).toBe("privy");
          expect(parsed.searchParams.get("mode")).toBe("link");
          expect(parsed.searchParams.get("link_intent")).toBe(
            "link-intent-123",
          );
          const redirectUri = parsed.searchParams.get("redirect_uri");
          const state = parsed.searchParams.get("state");
          expect(redirectUri).toBeTruthy();
          expect(state).toBeTruthy();
          await originalFetch(
            `${redirectUri}?code=link-grant-code&state=${encodeURIComponent(
              state ?? "",
            )}`,
          );
        },
        timeoutMs: 5_000,
      });

      expect(result).toMatchObject({
        provider: "privy",
        status: "linked",
      });
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});
