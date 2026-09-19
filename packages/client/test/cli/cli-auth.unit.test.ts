import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const ORIGINAL_ENV = { ...process.env };
const PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const ACCOUNT = privateKeyToAccount(PRIVATE_KEY);

describe("CLI BetterAuth SIWE auth", () => {
  let stateDir: string;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    stateDir = mkdtempSync(join(tmpdir(), "aomi-cli-auth-"));
    process.env.AOMI_STATE_DIR = stateDir;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    rmSync(stateDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("signs the BetterAuth SIWE nonce and persists the session token with expiry", async () => {
    const { signInWithCliSiwe } = await import("../../src/cli/auth");
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/siwe/nonce")) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({});
          return Response.json(
            {
              nonce: "nonce-123",
              domain: "portal.test",
              uri: "https://portal.test",
            },
            {},
          );
        }
        if (url.endsWith("/api/auth/siwe/verify")) {
          expect(init?.method).toBe("POST");
          expect(new Headers(init?.headers).get("Cookie")).toBeNull();
          const body = JSON.parse(String(init?.body));
          expect(Object.keys(body).sort()).toEqual(["message", "signature"]);
          expect(body.message).toContain("portal.test wants you to sign in");
          expect(body.message).toContain(`\n${ACCOUNT.address}\n`);
          expect(body.message).toContain("Nonce: nonce-123");
          expect(body.signature).toMatch(/^0x[0-9a-f]+$/i);
          return Response.json(
            {
              ok: true,
              user_id: "canonical-user",
            },
            {
              headers: {
                "set-auth-token": "better-auth-session-token",
              },
            },
          );
        }
        if (url.endsWith("/v1/account")) {
          const headers = new Headers(init?.headers);
          expect(headers.get("Authorization")).toBe(
            "Bearer better-auth-session-token",
          );
          return Response.json({
            session: {
              betterAuthUserId: "canonical-user",
              expiresAt: "2030-01-02T03:04:05.000Z",
            },
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    ) as unknown as typeof fetch;

    const result = await signInWithCliSiwe({
      baseUrl: "https://portal.test",
      privateKey: PRIVATE_KEY,
      chainId: 8453,
      fetch: fetchMock,
    });

    expect(result.address).toBe(ACCOUNT.address);
    expect(result.auth).toEqual({
      sessionToken: "better-auth-session-token",
      expiresAt: Date.parse("2030-01-02T03:04:05.000Z"),
      walletFamily: "evm",
      walletAddress: ACCOUNT.address,
      chainId: 8453,
      betterAuthUserId: "canonical-user",
    });
  });

  it("provides only unexpired BetterAuth session tokens to AomiClient", async () => {
    const { createCliAuthTokenProvider } = await import("../../src/cli/auth");

    const validProvider = createCliAuthTokenProvider(
      () => ({
        auth: {
          sessionToken: "session-token",
          expiresAt: 60_000,
        },
      }),
      () => 1_000,
    );
    await expect(validProvider()).resolves.toBe("session-token");

    const expiredProvider = createCliAuthTokenProvider(
      () => ({
        auth: {
          sessionToken: "session-token",
          expiresAt: 10_000,
        },
      }),
      () => 10_000,
    );
    await expect(expiredProvider()).resolves.toBeUndefined();
  });

  it("signs in through BetterAuth SIWS and persists the canonical account session", async () => {
    const { signInWithCliSiws } = await import("../../src/cli/auth");
    const keypair = Keypair.generate();
    const secret = bs58.encode(keypair.secretKey);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/siws/nonce")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            walletAddress: keypair.publicKey.toBase58(),
            chainId: "solana:devnet",
            intent: "sign-in",
          });
          return Response.json({
            nonce: "solana-nonce",
            domain: "portal.test",
            uri: "https://portal.test",
          });
        }
        if (url.endsWith("/api/auth/siws/verify")) {
          const body = JSON.parse(String(init?.body));
          expect(body.message).toContain(
            "portal.test wants you to sign in with your Solana account",
          );
          expect(body.message).toContain("Chain ID: solana:devnet");
          expect(Buffer.from(body.signature, "base64")).toHaveLength(64);
          expect(body.intent).toBe("sign-in");
          return Response.json(
            {
              success: true,
              user: { id: "better-auth-solana-user" },
            },
            { headers: { "set-auth-token": "siws-session-token" } },
          );
        }
        if (url.endsWith("/v1/account")) {
          expect(new Headers(init?.headers).get("Authorization")).toBe(
            "Bearer siws-session-token",
          );
          return Response.json({
            session: {
              betterAuthUserId: "better-auth-solana-user",
              expiresAt: "2030-01-02T03:04:05.000Z",
            },
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    ) as unknown as typeof fetch;

    const result = await signInWithCliSiws({
      baseUrl: "https://portal.test",
      privateKey: secret,
      chainId: "solana:devnet",
      fetch: fetchMock,
    });

    expect(result.address).toBe(keypair.publicKey.toBase58());
    expect(result.auth).toEqual({
      sessionToken: "siws-session-token",
      expiresAt: Date.parse("2030-01-02T03:04:05.000Z"),
      walletFamily: "svm",
      walletAddress: keypair.publicKey.toBase58(),
      chainScope: "solana:devnet",
      betterAuthUserId: "better-auth-solana-user",
    });
  });

  it("signs localhost as the SIWE domain when the portal URL uses 127.0.0.1", async () => {
    const { signInWithCliSiwe } = await import("../../src/cli/auth");
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/siwe/nonce")) {
          return Response.json({ nonce: "nonce-123" });
        }
        if (url.endsWith("/api/auth/siwe/verify")) {
          const body = JSON.parse(String(init?.body));
          expect(body.message).toContain("localhost:3000 wants you to sign in");
          return Response.json(
            { success: true },
            { headers: { "set-auth-token": "better-auth-session-token" } },
          );
        }
        if (url.endsWith("/v1/account")) {
          return Response.json({ session: null });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    ) as unknown as typeof fetch;

    await signInWithCliSiwe({
      baseUrl: "http://127.0.0.1:3000",
      privateKey: PRIVATE_KEY,
      fetch: fetchMock,
    });
  });

  it("logs out and clears the stored CLI auth session and signing keys", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://portal.test/api/auth/sign-out");
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer session-token",
        );
        expect(new Headers(init?.headers).get("Content-Type")).toBe(
          "application/json",
        );
        expect(init?.body).toBe("{}");
        return Response.json({ success: true });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { CliSession } = await import("../../src/cli/cli-session");
    const { logoutCommand } = await import("../../src/cli/commands/account");
    const { readState } = await import("../../src/cli/state");

    const cli = CliSession.loadOrCreate({
      baseUrl: "https://portal.test",
      app: "default",
      execution: "eoa",
      secrets: {},
    });
    cli.setAuthSession({
      sessionToken: "session-token",
      expiresAt: Date.now() + 60_000,
    });
    cli.setWallet(PRIVATE_KEY, ACCOUNT.address);
    cli.setSvmWallet("solana-secret", "solana-public");

    await logoutCommand({ secrets: {} });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readState()).toEqual(
      expect.objectContaining({
        auth: undefined,
        privateKey: undefined,
        svmPrivateKey: undefined,
      }),
    );
    expect(logSpy).toHaveBeenCalledWith("Signed out");
  });
});
