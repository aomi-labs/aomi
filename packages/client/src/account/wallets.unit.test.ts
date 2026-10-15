import { describe, expect, it, vi } from "vitest";
import { Aomi } from "../sdk/aomi";
import { AomiClient, wrapFetchWithPublicApiAuthorization } from "../client";
import type { AomiOAuthTokenRequest } from "../authorization";
import {
  AomiWalletError,
  WALLET_ERROR_CODES,
  activeWalletOf,
  parseWalletRef,
  walletRef,
  type AomiAccountWallet,
} from "./wallets";

const agent = {
  id: "w_12",
  kind: "agent",
  family: "evm",
  address: "0x7a3f00000000000000000000000000000000c41e",
  label: "Agent wallet",
  custom_label: null,
  wallet_app: null,
  provider: "para",
  is_default: true,
  status: "ready",
  merged: false,
  bound_app: null,
  rule: {
    mode: "ask",
    rule_version: 3,
    instant: [
      { client: "telegram:7712345678", kind: "telegram", label: "@HooditBot" },
    ],
  },
  created_at: 1_760_000_000,
};
const hoodit = {
  ...agent,
  id: "w_31",
  label: "Hoodit wallet",
  is_default: false,
  merged: true,
  bound_app: { id: 42, name: "hoodit", label: "Hoodit" },
  rule: { mode: "ask", rule_version: 0, instant: [] },
};
// The contract's example omits fields on non-agent entries.
const privy = {
  id: "w_9",
  kind: "embedded",
  family: "svm",
  address: "Dmf3XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  label: "Privy",
  provider: "privy",
  status: "linked",
  rule: null,
};
const balance = {
  id: "w_12",
  family: "evm",
  address: agent.address,
  as_of: 1_760_000_000,
  total_usd: "412.80",
  chains: [
    {
      chain: "8453",
      name: "Base",
      native_symbol: "ETH",
      source: "indexed",
      native: { amount: "0.004", usd: "10.20" },
      tokens: [
        {
          symbol: "USDC",
          address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          amount: "402.60",
          usd: "402.60",
        },
      ],
      error: null,
    },
    {
      chain: "1",
      name: "Ethereum",
      native_symbol: "ETH",
      source: "rpc",
      native: null,
      tokens: [],
      error: "unavailable",
    },
  ],
};

function backend(routes: Record<string, (body: unknown) => Response>): {
  client: AomiClient;
  calls: { method: string; path: string; headers: Headers; body: unknown }[];
  fetch: typeof fetch;
} {
  const calls: {
    method: string;
    path: string;
    headers: Headers;
    body: unknown;
  }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      path: url.pathname,
      headers: new Headers(init?.headers),
      body,
    });
    const route = routes[`${method} ${url.pathname}`];
    return route
      ? route(body)
      : Response.json({ error: "unexpected" }, { status: 500 });
  }) as typeof globalThis.fetch;
  return {
    client: new AomiClient({
      baseUrl: "https://api.example",
      guest: false,
      fetch,
    }),
    calls,
    fetch,
  };
}

describe("account wallets", () => {
  it("lists every wallet with the step 3 shape, filling omitted fields", async () => {
    const { client, calls } = backend({
      "GET /v1/account/wallets": () =>
        Response.json({ wallets: [agent, hoodit, privy] }),
    });
    const wallets = await client.account.wallets.listWallets();
    expect(calls[0]).toMatchObject({ method: "GET" });
    expect(calls[0]!.headers.has("x-aomi-csrf")).toBe(false);
    expect(wallets.map((wallet) => wallet.id)).toEqual(["w_12", "w_31", "w_9"]);
    expect(wallets[0]).toEqual(agent satisfies AomiAccountWallet);
    expect(wallets[1]).toMatchObject({
      merged: true,
      bound_app: { id: 42, label: "Hoodit" },
    });
    expect(wallets[2]).toEqual({
      ...privy,
      custom_label: null,
      wallet_app: null,
      is_default: false,
      merged: false,
      bound_app: null,
      created_at: null,
    });
  });

  it("rejects a wallet id that is not a w_ id", async () => {
    const { client } = backend({
      "GET /v1/account/wallets": () =>
        Response.json({ wallets: [{ ...agent, id: "12" }] }),
    });
    await expect(client.account.wallets.listWallets()).rejects.toThrow(
      /not a w_ id/,
    );
  });

  it("creates agent wallets for both families by default and reports per-family failures", async () => {
    const { client, calls } = backend({
      "POST /v1/account/wallets/agent": () =>
        Response.json({
          wallets: [agent],
          created: ["w_12"],
          failed: [{ family: "svm", error: "agent_wallet_provider_error" }],
        }),
    });
    const result = await client.account.wallets.createAgentWallets();
    expect(calls[0]!.body).toEqual({ families: ["evm", "svm"] });
    expect(calls[0]!.headers.get("x-aomi-csrf")).toBe("1");
    expect(result).toEqual({
      wallets: [agent],
      created: ["w_12"],
      failed: [{ family: "svm", error: "agent_wallet_provider_error" }],
    });
  });

  it.each([
    [400, "invalid_family"],
    [403, "guest_account"],
    [503, "agent_wallet_unavailable"],
    [502, "agent_wallet_provider_error"],
  ])("keeps the %i %s error code", async (status, code) => {
    const { client } = backend({
      "POST /v1/account/wallets/agent": () =>
        Response.json({ error: code }, { status }),
    });
    const failure = await client.account.wallets
      .createAgentWallets(["evm"])
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AomiWalletError);
    expect(failure).toMatchObject({ status, code });
  });

  it("reads a balance by w_ id, keeping a chain that could not be read", async () => {
    const { client, calls } = backend({
      "GET /v1/account/wallets/w_12/balance": () => Response.json(balance),
    });
    const result = await client.account.wallets.walletBalance("w_12");
    expect(calls[0]!.path).toBe("/v1/account/wallets/w_12/balance");
    expect(result.total_usd).toBe("412.80");
    expect(result.chains.map((chain) => [chain.name, chain.error])).toEqual([
      ["Base", null],
      ["Ethereum", "unavailable"],
    ]);
  });

  it("answers a foreign or missing wallet with wallet_not_found", async () => {
    const { client } = backend({
      "GET /v1/account/wallets/w_99/balance": () =>
        Response.json({ error: "wallet_not_found" }, { status: 404 }),
    });
    await expect(
      client.account.wallets.walletBalance("w_99"),
    ).rejects.toMatchObject({
      status: 404,
      code: WALLET_ERROR_CODES.walletNotFound,
    });
  });

  it("switches the thread's wallet with the thread header", async () => {
    const { client, calls } = backend({
      "PUT /api/thread/wallet": () =>
        Response.json({ active_wallet: { evm: "w_12", svm: "w_13" } }),
    });
    const result = await client.account.wallets.setThreadWallet(
      "thread-1",
      "w_12",
    );
    expect(result).toEqual({ active_wallet: { evm: "w_12", svm: "w_13" } });
    expect(calls[0]!.body).toEqual({ id: "w_12" });
    expect(calls[0]!.headers.get("x-thread-id")).toBe("thread-1");
    expect(calls[0]!.headers.get("x-aomi-csrf")).toBe("1");
  });

  it("surfaces a pending switch as wallet_switch_pending", async () => {
    const { client } = backend({
      "PUT /api/thread/wallet": () =>
        Response.json({ error: "wallet_switch_pending" }, { status: 409 }),
    });
    await expect(
      client.account.wallets.setThreadWallet("thread-1", "w_4"),
    ).rejects.toMatchObject({ status: 409, code: "wallet_switch_pending" });
  });

  it("parses w_ ids exactly", () => {
    expect(walletRef(12)).toBe("w_12");
    expect(parseWalletRef("w_12")).toBe("12");
    for (const value of ["12", "w_0", "w_012", "w_12x", "W_12", "w_"])
      expect(parseWalletRef(value)).toBeUndefined();
    expect(() => walletRef("0")).toThrow(TypeError);
    expect(activeWalletOf({ evm: "w_1", svm: "nope" })).toEqual({ evm: "w_1" });
    expect(activeWalletOf(null)).toBeUndefined();
  });
});

describe("aomi.wallets", () => {
  it("lists the account's wallets and reads a balance", async () => {
    const { fetch } = backend({
      "GET /v1/account/wallets": () => Response.json({ wallets: [agent] }),
      "GET /v1/account/wallets/w_12/balance": () => Response.json(balance),
    });
    const aomi = new Aomi({
      baseUrl: "https://api.example",
      guest: false,
      fetch,
    });
    expect((await aomi.wallets.list()).map((wallet) => wallet.id)).toEqual([
      "w_12",
    ]);
    expect((await aomi.wallets.balance("w_12")).total_usd).toBe("412.80");
  });

  it("asks an OAuth client for agent:read on the agent resource", async () => {
    const upstream = vi.fn(async () => Response.json({ wallets: [] }));
    const oauth = vi.fn(async (request: AomiOAuthTokenRequest) => ({
      accessToken: "agent-token",
      expiresAt: Date.now() + 60_000,
      resource: request.resource,
      scopes: request.scopes,
    }));
    const authorized = wrapFetchWithPublicApiAuthorization({
      fetch: upstream as typeof fetch,
      baseUrl: "https://chat.aomi.dev",
      oauth,
    });
    await authorized("https://chat.aomi.dev/v1/account/wallets");
    await authorized("https://chat.aomi.dev/v1/account/wallets/w_12/balance");
    await authorized("https://chat.aomi.dev/v1/account/wallets/w_12/rule");
    for (const call of oauth.mock.calls)
      expect(call[0]).toEqual({
        resource: "https://chat.aomi.dev/v1/agent",
        scopes: ["agent:read"],
        forceRefresh: false,
      });
    expect(oauth).toHaveBeenCalledTimes(3);
  });
});

const rule = {
  id: "w_12",
  rule_version: 3,
  paused: false,
  clients: [
    { client: "portal", kind: "portal", label: "Portal", instant: false },
    { client: "cli", kind: "cli", label: "CLI", instant: false },
    { client: "mcp", kind: "mcp", label: "AI clients (MCP)", instant: false },
    {
      client: "telegram:7712345678",
      kind: "telegram",
      label: "@HooditBot",
      instant: true,
      detail: "kept on from the beta",
    },
  ],
};

describe("wallet rules (step 4)", () => {
  it("reads the per-client switches and writes the full desired state", async () => {
    const { fetch, calls } = backend({
      "GET /v1/account/wallets/w_12/rule": () => Response.json(rule),
      "PUT /v1/account/wallets/w_12/rule": () =>
        Response.json({
          ...rule,
          rule_version: 4,
          paused: true,
          clients: rule.clients.map((client) => ({
            ...client,
            instant: client.client === "mcp",
          })),
        }),
    });
    const aomi = new Aomi({
      baseUrl: "https://api.example",
      guest: false,
      fetch,
    });
    const read = await aomi.wallets.rule("w_12");
    expect(
      read.clients.map((client) => [client.client, client.instant]),
    ).toEqual([
      ["portal", false],
      ["cli", false],
      ["mcp", false],
      ["telegram:7712345678", true],
    ]);
    expect(read.clients[3]!.detail).toBe("kept on from the beta");

    const written = await aomi.wallets.setRule("w_12", {
      rule_version: 3,
      paused: true,
      instant: ["mcp"],
    });
    expect(calls.at(-1)).toMatchObject({
      method: "PUT",
      path: "/v1/account/wallets/w_12/rule",
      body: { rule_version: 3, paused: true, instant: ["mcp"] },
    });
    expect(calls.at(-1)!.headers.get("x-aomi-csrf")).toBe("1");
    expect(written).toMatchObject({ rule_version: 4, paused: true });
  });

  it("surfaces a stale write as rule_version_conflict", async () => {
    const { client } = backend({
      "PUT /v1/account/wallets/w_12/rule": () =>
        Response.json({ error: "rule_version_conflict" }, { status: 409 }),
    });
    await expect(
      client.account.wallets.setWalletRule("w_12", {
        rule_version: 2,
        paused: false,
        instant: [],
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: WALLET_ERROR_CODES.ruleVersionConflict,
    });
  });
});

describe("connected apps (step 4)", () => {
  it("lists OAuth clients and Telegram, and disconnects one client", async () => {
    const { client, calls } = backend({
      "GET /v1/account/connections": () =>
        Response.json({
          oauth: [
            {
              client_id: "c1",
              name: "Claude Code",
              kind: "mcp",
              connected_at: 1_760_400_000,
            },
            { client_id: "c2", name: "Script", kind: "other" },
          ],
          telegram: {
            username: "arixon",
            bots: [{ bot_id: "7712345678", label: "@HooditBot" }],
          },
        }),
      "DELETE /v1/account/connections/oauth/c1": () =>
        Response.json({ revoked: true }),
    });
    const connections = await client.account.connections.list();
    expect(connections.oauth).toEqual([
      {
        client_id: "c1",
        name: "Claude Code",
        kind: "mcp",
        connected_at: 1_760_400_000,
      },
      { client_id: "c2", name: "Script", kind: "api", connected_at: null },
    ]);
    expect(connections.telegram?.bots[0]?.label).toBe("@HooditBot");

    await client.account.connections.disconnectOAuth("c1");
    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      path: "/v1/account/connections/oauth/c1",
    });
    expect(calls.at(-1)!.headers.get("x-aomi-csrf")).toBe("1");
  });

  it("reads a missing Telegram link as null and a gone client as 404", async () => {
    const { client } = backend({
      "GET /v1/account/connections": () =>
        Response.json({ oauth: [], telegram: null }),
      "DELETE /v1/account/connections/oauth/gone": () =>
        Response.json({ code: "connection_not_found" }, { status: 404 }),
    });
    expect(await client.account.connections.list()).toEqual({
      oauth: [],
      telegram: null,
    });
    await expect(
      client.account.connections.disconnectOAuth("gone"),
    ).rejects.toMatchObject({ status: 404, code: "connection_not_found" });
  });
});
