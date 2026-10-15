import { beforeEach, describe, expect, it, vi } from "vitest";
import { AomiClient, type AomiAccountWallet } from "@aomi-labs/client";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof globalThis.fetch>(),
  close: vi.fn(),
}));
vi.mock("../cli-session", () => ({
  CliSession: {
    loadOrCreate: () => ({
      sessionId: "cli-thread-1",
      createClientSession: () => ({
        close: mocks.close,
        client: new AomiClient({
          baseUrl: "https://example.test",
          guest: false,
          fetch: mocks.fetch,
        }),
      }),
    }),
  },
}));
vi.mock("../errors", () => ({
  fatal: (message: string) => {
    throw new Error(message);
  },
}));

import { walletsListCommand, walletsUseCommand } from "./wallets";

const wallet = (overrides: Partial<AomiAccountWallet>): AomiAccountWallet => ({
  id: "w_1",
  kind: "agent",
  family: "evm",
  address: "0x1111111111111111111111111111111111111111",
  label: "Agent wallet",
  custom_label: null,
  wallet_app: null,
  provider: null,
  is_default: true,
  status: "ready",
  merged: false,
  bound_app: null,
  rule: { mode: "ask", rule_version: 1, instant: [] },
  created_at: 1_760_529_600,
  ...overrides,
});

const wallets = [
  wallet({}),
  wallet({
    id: "w_2",
    label: "Trading",
    rule: {
      mode: "ask",
      rule_version: 4,
      instant: [
        { client: "portal", kind: "portal", label: "Portal" },
        { client: "mcp", kind: "mcp", label: "MCP" },
      ],
    },
  }),
  wallet({
    id: "w_3",
    family: "svm",
    address: "J2w7ZT5Wd4ACuQAH3dmzjWoRhaqejMRoMRL4C7Qbg5Ks",
    label: "Solana agent",
    status: "paused",
    rule: { mode: "paused", rule_version: 2, instant: [] },
  }),
  wallet({
    id: "w_4",
    kind: "browser",
    address: "0x4444444444444444444444444444444444444444",
    label: "Rabby",
    is_default: false,
    status: "linked",
    rule: null,
  }),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("aomi wallets", () => {
  it("prints id, kind, family, address, label and rule", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ wallets }));
    await walletsListCommand({ secrets: {} });

    expect(String(mocks.fetch.mock.calls[0]?.[0])).toBe(
      "https://example.test/v1/account/wallets",
    );
    const lines = String(vi.mocked(console.log).mock.calls[0]?.[0]).split("\n");
    expect(lines[0]).toMatch(/^ID\s+KIND\s+FAMILY\s+ADDRESS\s+LABEL\s+RULE$/);
    expect(lines[1]).toMatch(
      /^w_1\s+agent\s+evm\s+0x1111\S+\s+Agent wallet\s+ask$/,
    );
    expect(lines[2]).toMatch(/Trading\s+ask · instant: Portal, MCP$/);
    expect(lines[3]).toMatch(
      /^w_3\s+agent\s+svm\s+J2w7\S+\s+Solana agent\s+paused$/,
    );
    expect(lines[4]).toMatch(/^w_4\s+browser\s+evm\s+0x4444\S+\s+Rabby\s+—$/);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("sets the active wallet on the session's thread", async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ active_wallet: { evm: "w_2" } }),
    );
    await walletsUseCommand({ secrets: {} }, "w_2");

    const [url, init] = mocks.fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://example.test/api/thread/wallet");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ id: "w_2" });
    expect(new Headers(init?.headers).get("X-Session-Id")).toBe("cli-thread-1");
    expect(console.log).toHaveBeenCalledWith(
      "Using w_2 in session cli-thread-1 (active: evm w_2)",
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("requires an id", async () => {
    await expect(walletsUseCommand({ secrets: {} }, "")).rejects.toThrow(
      "Usage: aomi wallets use <id>",
    );
  });
});
