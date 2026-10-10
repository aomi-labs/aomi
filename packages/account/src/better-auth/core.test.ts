// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("better-auth/next-js", () => {
  throw new Error("The native auth entry must not load the Next integration");
});

describe("native account authentication", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    );
    vi.stubEnv("BETTER_AUTH_URL", "https://chat.aomi.dev");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves the account protocol and installs the host's cookie hooks last", async () => {
    const { createAccountAuth } = await import("./core");
    const cookiePlugin = { id: "host-cookies", hooks: { after: [] } };
    const auth = createAccountAuth(cookiePlugin);

    expect(auth.options.plugins.at(-1)).toBe(cookiePlugin);
    expect(auth.options.plugins.map((plugin) => plugin.id)).toEqual(
      expect.arrayContaining([
        "oauth-provider",
        "cimd",
        "device-authorization",
        "siwe",
        "anonymous",
      ]),
    );
    expect(auth.options).toMatchObject({
      baseURL: "https://chat.aomi.dev",
      basePath: "/api/auth",
      disabledPaths: ["/token"],
      session: { modelName: "ba_sessions", expiresIn: 60 * 60 * 24 * 7 },
      rateLimit: { enabled: true },
    });
    expect(auth.api.signInAnonymous).toBeTypeOf("function");
    expect(auth.api.getSession).toBeTypeOf("function");
  });

  it("rejects an unapproved preview host before reaching the auth handler", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "exact-preview.vercel.app");
    const { createWalletAuthRequestHandler } = await import("./core");
    const handler = vi.fn(
      async (_request: Request) => new Response("authenticated"),
    );
    const handle = createWalletAuthRequestHandler({
      handler,
      options: { baseURL: "https://chat.aomi.dev" },
    });

    const response = await handle(
      new Request("https://untrusted.example/api/auth/siwe/nonce"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "PREVIEW_AUTH_ORIGIN_NOT_ALLOWED",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps wallet metadata out of the strict proof body and preserves the raw response", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "exact-preview.vercel.app");
    const { createWalletAuthRequestHandler } = await import("./core");
    const response = new Response("signed in", {
      headers: { "set-cookie": "session=signed; HttpOnly; Secure; SameSite=Lax" },
    });
    const handler = vi.fn(async (_request: Request) => response);
    const handle = createWalletAuthRequestHandler({
      handler,
      options: { baseURL: "https://chat.aomi.dev" },
    });
    const request = new Request(
      "https://exact-preview.vercel.app/api/auth/siwe/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "proof",
          signature: "signed",
          walletApp: "Fixture Wallet",
        }),
      },
    );

    expect(await handle(request)).toBe(response);
    await expect(handler.mock.calls[0]?.[0].json()).resolves.toEqual({
      message: "proof",
      signature: "signed",
    });
  });
});
