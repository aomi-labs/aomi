import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

const baseConfig = {
  baseUrl: "http://unit.test",
  app: "default",
  execution: "eoa" as const,
  secrets: {},
};

describe("aomi account whoami", () => {
  let stateDir: string;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    stateDir = mkdtempSync(join(tmpdir(), "aomi-cli-whoami-"));
    process.env.AOMI_STATE_DIR = stateDir;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    rmSync(stateDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("prints the bound account identity when authenticated", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { whoamiCommand } = await import("../../src/cli/commands/account");

    CliSession.loadOrCreate({ ...baseConfig, accountBearer: "bearer-1" });

    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: vi.fn(async () => ({
        user: { user_id: "user-1", verified_email: "a@b.c", tier: "free" },
        user_accounts: [
          {
            address: { chain: "evm", address: "0xabc" },
            auth_provider: "privy",
            is_primary: true,
            provider_managed: false,
          },
          {
            address: {
              chain: "svm",
              address: "So11111111111111111111111111111111111111112",
            },
            auth_provider: "privy",
            is_primary: false,
            provider_managed: false,
          },
        ],
        signing_policies: [
          {
            address: { chain: "evm", address: "0xabc" },
            mode: "manual",
            authorization_version: 1,
          },
          {
            address: {
              chain: "svm",
              address: "So11111111111111111111111111111111111111112",
            },
            mode: "auto",
            authorization_version: 1,
          },
        ],
      })),
    } as unknown as Response;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await whoamiCommand(baseConfig);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("user-1"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("a@b.c"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Wallets:  2"));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ethereum [privy]: 0xabc"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Solana [privy]: So11111111111111111111111111111111111111112",
      ),
    );
  });

  it("reports an anonymous session and hints at the credential flags", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { whoamiCommand } = await import("../../src/cli/commands/account");

    CliSession.loadOrCreate(baseConfig);

    const response = {
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: vi.fn(async () => ({})),
    } as unknown as Response;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await whoamiCommand(baseConfig);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Not bound to an account"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("--account-bearer"),
    );
  });

});
