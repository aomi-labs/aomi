import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const ORIGINAL_ENV = { ...process.env };
const PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const baseConfig = {
  baseUrl: "https://portal.test",
  app: "default",
  execution: "eoa" as const,
  secrets: {},
};

const accountGraph = {
  user: {
    id: "aomi-user-1",
    displayName: "Ada",
    email: "ada@example.com",
  },
  linkedAccounts: [
    {
      id: "identity-privy",
      provider: "privy",
      subject: "did:privy:user",
      email: "ada@example.com",
      displayLabel: "Privy main",
    },
    {
      id: "identity-siwe",
      provider: "siwe",
      subject: "eip155:1:0xabc",
    },
  ],
  wallets: [
    {
      id: "wallet-privy",
      family: "evm",
      address: "0x1111111111111111111111111111111111111111",
      kind: "embedded",
      provider: "privy",
      linkedVia: "privy",
      chainId: 1,
      label: "Privy Wallet",
    },
    {
      id: "wallet-siwe",
      family: "evm",
      address: "0x2222222222222222222222222222222222222222",
      kind: "external",
      provider: "siwe",
      linkedVia: "siwe",
      chainId: 8453,
    },
  ],
  session: {
    betterAuthUserId: "ba-user-1",
    expiresAt: Date.parse("2035-01-02T03:04:05.000Z"),
  },
};

describe("aomi account link management", () => {
  let stateDir: string;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    stateDir = mkdtempSync(join(tmpdir(), "aomi-cli-account-links-"));
    process.env.AOMI_STATE_DIR = stateDir;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    rmSync(stateDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("prints account graph links and child wallets", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { accountLinksCommand } =
      await import("../../src/cli/commands/account");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://portal.test/v1/account");
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer session-token",
        );
        return Response.json(accountGraph);
      }),
    );
    const cli = CliSession.loadOrCreate(baseConfig);
    cli.setAuthSession({
      sessionToken: "session-token",
      expiresAt: Date.now() + 60_000,
    });

    await accountLinksCommand({ secrets: {} });

    expect(logSpy).toHaveBeenCalledWith("Account:  aomi-user-1");
    expect(logSpy).toHaveBeenCalledWith("Login methods: 2");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("identity:identity-privy privy"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("wallet:wallet-privy evm [privy]"),
    );
  });

  it("prints account links as JSON", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { accountLinksCommand } =
      await import("../../src/cli/commands/account");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(accountGraph)),
    );
    const cli = CliSession.loadOrCreate(baseConfig);
    cli.setAuthSession({
      sessionToken: "session-token",
      expiresAt: Date.now() + 60_000,
    });

    await accountLinksCommand({ secrets: {}, json: true });

    const parsed = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
    expect(parsed.user.id).toBe("aomi-user-1");
    expect(parsed.linkedAccounts).toHaveLength(2);
    expect(parsed.wallets).toHaveLength(2);
  });

  it("links an EVM wallet with a SIWE account-link message", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { accountLinkCommand } =
      await import("../../src/cli/commands/account");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://portal.test/v1/account/wallets/link?")) {
          expect(new Headers(init?.headers).get("Authorization")).toBe(
            "Bearer session-token",
          );
          return Response.json({
            nonce: "wallet-link-nonce",
            domain: "portal.test",
            uri: "https://portal.test",
          });
        }
        if (url === "https://portal.test/v1/account/wallets/link") {
          const body = JSON.parse(String(init?.body));
          expect(body.family).toBe("evm");
          expect(body.address).toMatch(/^0x/i);
          expect(body.chainId).toBe(8453);
          expect(body.label).toBe("CLI wallet");
          expect(body.message).toContain(
            "portal.test wants to link this wallet to your Aomi account",
          );
          expect(body.message).toContain("Nonce: wallet-link-nonce");
          expect(body.signature).toMatch(/^0x/i);
          return Response.json({ status: "linked", account: accountGraph });
        }
        throw new Error(`unexpected URL ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const cli = CliSession.loadOrCreate({
      ...baseConfig,
      privateKey: PRIVATE_KEY,
    });
    cli.setAuthSession({
      sessionToken: "session-token",
      expiresAt: Date.now() + 60_000,
    });

    await accountLinkCommand(
      { ...baseConfig, privateKey: PRIVATE_KEY, chain: 8453 },
      { wallet: true, label: "CLI wallet" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("links a Solana wallet through BetterAuth SIWS", async () => {
    const keypair = Keypair.generate();
    const secret = bs58.encode(keypair.secretKey);
    const { CliSession } = await import("../../src/cli/cli-session");
    const { accountLinkCommand } =
      await import("../../src/cli/commands/account");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe("Bearer session-token");
        if (url === "https://portal.test/api/auth/siws/nonce") {
          expect(JSON.parse(String(init?.body))).toEqual({
            walletAddress: keypair.publicKey.toBase58(),
            chainId: "solana:devnet",
            intent: "link",
          });
          return Response.json({
            nonce: "siws-link-nonce",
            domain: "portal.test",
            uri: "https://portal.test",
          });
        }
        if (url === "https://portal.test/api/auth/siws/verify") {
          const body = JSON.parse(String(init?.body));
          expect(body.intent).toBe("link");
          expect(body.message).toContain(
            "portal.test wants you to sign in with your Solana account",
          );
          expect(body.message).toContain(
            "Only sign this message if you want this Solana wallet attached to the current Aomi account.",
          );
          expect(body.message).toContain("Nonce: siws-link-nonce");
          expect(Buffer.from(body.signature, "base64")).toHaveLength(64);
          return Response.json({ status: "linked", success: true });
        }
        if (url === "https://portal.test/v1/account") {
          return Response.json(accountGraph);
        }
        throw new Error(`unexpected URL ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const cli = CliSession.loadOrCreate(baseConfig);
    cli.setAuthSession({
      sessionToken: "session-token",
      expiresAt: Date.now() + 60_000,
    });

    await accountLinkCommand(
      {
        ...baseConfig,
        solanaPrivateKey: secret,
        svmCluster: "solana:devnet",
      },
      { solana: true },
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("links a provider through the device auth PKCE flow", async () => {
    const getDeviceProviderCredential = vi.fn(async () => ({
      provider: "privy" as const,
      status: "linked" as const,
      account: accountGraph,
    }));
    vi.doMock("../../src/cli/device-auth", async () => {
      const actual = await vi.importActual<
        typeof import("../../src/cli/device-auth")
      >("../../src/cli/device-auth");
      return { ...actual, getDeviceProviderCredential };
    });
    const { CliSession } = await import("../../src/cli/cli-session");
    const { accountLinkCommand } =
      await import("../../src/cli/commands/account");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const cli = CliSession.loadOrCreate(baseConfig);
    cli.setAuthSession({
      sessionToken: "session-token",
      expiresAt: Date.now() + 60_000,
    });

    await accountLinkCommand(baseConfig, { provider: "privy" });

    expect(getDeviceProviderCredential).toHaveBeenCalledWith({
      baseUrl: "https://portal.test",
      provider: "privy",
      sessionToken: "session-token",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renames and unlinks links by graph id", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { accountRenameCommand, accountUnlinkCommand } =
      await import("../../src/cli/commands/account");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${String(input)}`);
        if (String(input) === "https://portal.test/v1/account") {
          return Response.json(accountGraph);
        }
        return Response.json(
          init?.method === "DELETE" ? { status: "revoked" } : accountGraph,
        );
      }),
    );
    const cli = CliSession.loadOrCreate(baseConfig);
    cli.setAuthSession({
      sessionToken: "session-token",
      expiresAt: Date.now() + 60_000,
    });

    await accountRenameCommand(baseConfig, "identity-privy", {
      label: "Work Privy",
    });
    await accountUnlinkCommand(baseConfig, "wallet:wallet-siwe", { yes: true });

    expect(calls).toContain(
      "PATCH https://portal.test/v1/account/identities/identity-privy",
    );
    expect(calls).toContain(
      "DELETE https://portal.test/v1/account/wallets/wallet-siwe",
    );
  });

  it("deletes the account and clears local auth", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { readState } = await import("../../src/cli/state");
    const { accountDeleteCommand } =
      await import("../../src/cli/commands/account");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://portal.test/v1/account");
        expect(init?.method).toBe("DELETE");
        return Response.json({
          status: "deactivated",
          revokedIdentities: 2,
          revokedWallets: 3,
        });
      }),
    );
    const cli = CliSession.loadOrCreate(baseConfig);
    cli.setAuthSession({
      sessionToken: "session-token",
      expiresAt: Date.now() + 60_000,
    });

    await accountDeleteCommand(baseConfig, { yes: true });

    expect(readState()?.auth).toBeUndefined();
  });

  it("requires confirmation before unlinking or deleting", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { accountDeleteCommand, accountUnlinkCommand } =
      await import("../../src/cli/commands/account");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cli = CliSession.loadOrCreate(baseConfig);
    cli.setAuthSession({
      sessionToken: "session-token",
      expiresAt: Date.now() + 60_000,
    });

    await expect(accountDeleteCommand(baseConfig)).rejects.toMatchObject({
      code: 1,
    });
    await expect(
      accountUnlinkCommand(baseConfig, "wallet-siwe"),
    ).rejects.toMatchObject({ code: 1 });
  });
});
