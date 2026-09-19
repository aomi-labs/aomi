import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const ORIGINAL_ENV = { ...process.env };

const baseConfig = {
  baseUrl: "http://unit.test",
  app: "byreal",
  execution: "eoa" as const,
  secrets: {},
};
const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("aomi account login", () => {
  let stateDir: string;

  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../../src/cli/device-auth");
    vi.doUnmock("../../src/cli/oauth-device-auth");
    process.env = { ...ORIGINAL_ENV };
    stateDir = mkdtempSync(join(tmpdir(), "aomi-cli-login-"));
    process.env.AOMI_STATE_DIR = stateDir;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    rmSync(stateDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("uses least-privilege OAuth device grants by default", async () => {
    const oauthLogin = vi.fn(async (input: { resource: string }) => ({
      clientId: input.resource.endsWith("/v1/agent")
        ? "agent-client"
        : "pipeline-client",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.parse("2031-01-02T03:04:05.000Z"),
      resource: input.resource,
      scopes: input.resource.endsWith("/v1/agent")
        ? ["agent:read", "agent:write", "offline_access"]
        : ["pipeline:catalog", "offline_access"],
      tokenType: "Bearer" as const,
    }));
    vi.doMock("../../src/cli/oauth-device-auth", () => ({
      signInWithOAuthDevice: oauthLogin,
    }));
    const { accountLoginCommand } =
      await import("../../src/cli/commands/account");
    const { readState } = await import("../../src/cli/state");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await accountLoginCommand(baseConfig);

    expect(oauthLogin).toHaveBeenCalledTimes(2);
    expect(oauthLogin.mock.calls.map(([input]) => input)).toEqual([
      {
        baseUrl: "http://unit.test",
        resource: "http://unit.test/v1/agent",
        scopes: ["agent:read", "agent:write", "offline_access"],
      },
      {
        baseUrl: "http://unit.test",
        resource: "http://unit.test/v1/pipeline",
        scopes: ["pipeline:catalog", "offline_access"],
      },
    ]);
    expect(Object.keys(readState()?.oauthGrants ?? {})).toEqual([
      "http://unit.test/v1/agent",
      "http://unit.test/v1/pipeline",
    ]);
    expect(logSpy).toHaveBeenCalledWith(
      "Signed in with OAuth device authorization",
    );
  });

  it("passes an explicit provider to device auth", async () => {
    const deviceLogin = vi.fn(async () => ({
      provider: "para" as const,
      auth: {
        sessionToken: "para-session",
        expiresAt: Date.parse("2031-01-02T03:04:05.000Z"),
      },
    }));
    vi.doMock("../../src/cli/device-auth", () => ({
      signInWithDeviceProvider: deviceLogin,
    }));
    const { accountLoginCommand } =
      await import("../../src/cli/commands/account");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await accountLoginCommand(baseConfig, { provider: "para" });

    expect(deviceLogin).toHaveBeenCalledWith({
      baseUrl: "http://unit.test",
      provider: "para",
    });
  });

  it("rejects an unknown device provider", async () => {
    const deviceLogin = vi.fn();
    vi.doMock("../../src/cli/device-auth", () => ({
      signInWithDeviceProvider: deviceLogin,
    }));
    const { accountLoginCommand } =
      await import("../../src/cli/commands/account");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      accountLoginCommand(baseConfig, { provider: "unknown" }),
    ).rejects.toMatchObject({ code: 1 });
    expect(deviceLogin).not.toHaveBeenCalled();
  });

  it("establishes an account session through BetterAuth SIWE", async () => {
    const { accountLoginCommand } =
      await import("../../src/cli/commands/account");

    const nativeFetch = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith("/api/auth/siwe/nonce")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn(async () => ({
            nonce: "abc123def456",
            domain: "chat.aomi.dev",
            uri: "https://chat.aomi.dev",
          })),
          headers: new Headers(),
        } as unknown as Response;
      }
      if (target.endsWith("/api/auth/siwe/verify")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn(async () => ({
            ok: true,
            user_id: "canonical-user",
          })),
          headers: new Headers({ "set-auth-token": "session-123" }),
        } as unknown as Response;
      }
      if (target.endsWith("/v1/account")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn(async () => ({
            session: {
              betterAuthUserId: "canonical-user",
              expiresAt: "2030-01-02T03:04:05.000Z",
            },
          })),
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${target}`);
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", nativeFetch);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await accountLoginCommand({
        ...baseConfig,
        baseUrl: "https://chat.aomi.dev",
        privateKey: TEST_PRIVATE_KEY,
      });

      expect(nativeFetch).toHaveBeenNthCalledWith(
        1,
        "https://chat.aomi.dev/api/auth/siwe/nonce",
        expect.objectContaining({
          method: "POST",
        }),
      );
      expect(String(nativeFetch.mock.calls[1]?.[0])).toBe(
        "https://chat.aomi.dev/api/auth/siwe/verify",
      );
      const verifyInit = nativeFetch.mock.calls[1]?.[1] as RequestInit;
      expect(new Headers(verifyInit.headers).get("Content-Type")).toBe(
        "application/json",
      );
      expect(new Headers(verifyInit.headers).get("Cookie")).toBeNull();
      expect(JSON.parse(verifyInit.body as string)).toEqual({
        message: expect.stringContaining("Nonce: abc123def456"),
        signature: expect.stringMatching(/^0x/),
      });
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Signed in with 0x"),
      );
      expect(logSpy).toHaveBeenCalledWith(
        "Session expires at 2030-01-02T03:04:05.000Z",
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("requires an EVM private key", async () => {
    const { accountLoginCommand } =
      await import("../../src/cli/commands/account");

    const nativeFetch = vi.fn();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", nativeFetch);
    vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        accountLoginCommand(baseConfig, { noBrowser: true }),
      ).rejects.toMatchObject({
        code: 1,
      });
      expect(nativeFetch).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("establishes an account session through BetterAuth SIWS", async () => {
    const keypair = Keypair.generate();
    const secret = bs58.encode(keypair.secretKey);
    const { accountLoginCommand } =
      await import("../../src/cli/commands/account");
    const nativeFetch = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith("/api/auth/siws/nonce")) {
        return Response.json({
          nonce: "siws-nonce",
          domain: "chat.aomi.dev",
          uri: "https://chat.aomi.dev",
        });
      }
      if (target.endsWith("/api/auth/siws/verify")) {
        return Response.json(
          { success: true, user: { id: "ba-svm-user" } },
          { headers: { "set-auth-token": "svm-session" } },
        );
      }
      if (target.endsWith("/v1/account")) {
        return Response.json({
          session: {
            betterAuthUserId: "ba-svm-user",
            expiresAt: "2030-01-02T03:04:05.000Z",
          },
        });
      }
      throw new Error(`unexpected fetch: ${target}`);
    });
    vi.stubGlobal("fetch", nativeFetch);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await accountLoginCommand(
      {
        ...baseConfig,
        baseUrl: "https://chat.aomi.dev",
        solanaPrivateKey: secret,
        svmCluster: "solana:devnet",
      },
      { solana: true },
    );

    expect(logSpy).toHaveBeenCalledWith(
      `Signed in with Solana wallet ${keypair.publicKey.toBase58()}`,
    );
  });
});
