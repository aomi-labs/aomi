import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const baseConfig = {
  baseUrl: "https://portal.test",
  app: "default",
  execution: "eoa" as const,
  secrets: {},
};
const position = {
  period_utc_month: "2026-09-01",
  included: {
    limit_microusd: 50_000_000,
    used_microusd: 5_250_000,
    remaining_microusd: 44_750_000,
  },
  balance_microusd: 1_500_000,
  reserved_microusd: 0,
  available_microusd: 1_500_000,
  debt_microusd: 0,
  entries: [
    {
      id: 1,
      amount_microusd: 1_500_000,
      entry_kind: "purchase",
      application_id: null,
      payment_method: "wallet",
      payment_provider: "coinbase",
      external_payment_reference: "0xtx",
      metadata: {},
      created_at: 1788264000,
    },
  ],
  next_before_id: null,
};
const funded = {
  funding_event: { id: "fund_test", status: "credited" },
  action: { kind: "done" },
};

describe("aomi account credits", () => {
  let stateDir: string;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    stateDir = mkdtempSync(join(tmpdir(), "aomi-cli-account-credits-"));
    process.env.AOMI_STATE_DIR = stateDir;
    const { CliSession } = await import("../cli-session");
    const cli = CliSession.loadOrCreate({
      ...baseConfig,
      privateKey: PRIVATE_KEY,
    });
    cli.setAuthSession({
      sessionToken: "session-token",
      expiresAt: Date.now() + 60_000,
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    rmSync(stateDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("prints the account credit position and activity", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json(position),
    );
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { accountCreditsShowCommand } = await import("./account");

    await accountCreditsShowCommand(baseConfig, { limit: "10" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://portal.test/v1/account/credits",
    );
    expect(log).toHaveBeenCalledWith("Monthly:     525 / 5,000 credits used");
    expect(log).toHaveBeenCalledWith("Credit balance: 150 credits");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("+150 purchase via wallet"),
    );
  });

  it("uses an explicit account bearer without a prior login session", async () => {
    rmSync(stateDir, { recursive: true, force: true });
    stateDir = mkdtempSync(join(tmpdir(), "aomi-cli-account-credits-bearer-"));
    process.env.AOMI_STATE_DIR = stateDir;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer account-bearer",
        );
        return Response.json(position);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { accountCreditsShowCommand } = await import("./account");

    await accountCreditsShowCommand(
      { ...baseConfig, accountBearer: "account-bearer" },
      { limit: "10" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends a wallet funding event with the active session and key", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.headers.get("authorization")).toBe(
          "Bearer session-token",
        );
        if (request.method === "POST") {
          expect(request.url).toBe(
            "https://portal.test/v1/account/credits/funding-events",
          );
          expect(await request.json()).toEqual({
            amount_microusd: 1_000_000,
            method: "wallet",
            chain: "eip155:84532",
          });
          return Response.json(funded);
        }
        return Response.json({ ...position, balance_microusd: 2_500_000 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { accountCreditsFundCommand } = await import("./account");

    await accountCreditsFundCommand(
      { ...baseConfig, privateKey: PRIVATE_KEY },
      "100",
      {
        chain: "eip155:84532",
        idempotencyKey: "cli-topup-1",
      },
    );

    expect(log).toHaveBeenCalledWith("Credit balance: 250 credits");
  });
  it("requires a caller-retained funding key before making a payment request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { accountCreditsFundCommand } = await import("./account");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      accountCreditsFundCommand(baseConfig, "100"),
    ).rejects.toThrow();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("--idempotency-key"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses the funding key after an unknown outcome", async () => {
    const keys: Array<string | null> = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.method !== "POST") return Response.json(position);
        keys.push(request.headers.get("idempotency-key"));
        return keys.length === 1
          ? new Response("unavailable", { status: 503 })
          : Response.json(funded);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { accountCreditsFundCommand } = await import("./account");
    const config = { ...baseConfig, privateKey: PRIVATE_KEY };
    await expect(
      accountCreditsFundCommand(config, "100", {
        chain: "eip155:84532",
        idempotencyKey: "recover-cli",
      }),
    ).rejects.toThrow();
    await accountCreditsFundCommand(config, "100", {
      chain: "eip155:84532",
      idempotencyKey: "recover-cli",
    });
    expect(keys).toEqual(["recover-cli", "recover-cli"]);
  });
});
