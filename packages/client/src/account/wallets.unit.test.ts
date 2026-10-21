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
import { TelegramLinkError, isTelegramLinkCode } from "./telegram-link";
import { commitRefError } from "../commit-ref";

const agent = {
  id: "w_12",
  kind: "agent",
  family: "evm",
  address: "0x7a3f00000000000000000000000000000000c41e",
  label: "Agent wallet",
  custom_label: null,
  browser_app: null,
  provider: "para",
  created_at: 1_760_000_000,
  agent_wallet_id: "6f1c2b8e-0000-4000-8000-000000000001",
  maker_app: null,
};
const hoodit = {
  ...agent,
  id: "w_31",
  label: "Hoodit",
  agent_wallet_id: "6f1c2b8e-0000-4000-8000-000000000002",
  maker_app: "Hoodit",
};
// The contract's example omits fields on non-agent entries.
const privy = {
  id: "w_9",
  kind: "embedded",
  family: "svm",
  address: "Dmf3XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  label: "Privy",
  provider: "privy",
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
    expect(wallets[1]).toMatchObject({ label: "Hoodit", maker_app: "Hoodit" });
    expect(wallets[2]).toEqual({
      ...privy,
      custom_label: null,
      browser_app: null,
      created_at: 0,
      agent_wallet_id: null,
      maker_app: null,
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
    await authorized("https://chat.aomi.dev/v1/account/agent-wallets");
    for (const call of oauth.mock.calls)
      expect(call[0]).toEqual({
        resource: "https://chat.aomi.dev/v1/agent",
        scopes: ["agent:read"],
        forceRefresh: false,
      });
    expect(oauth).toHaveBeenCalledTimes(3);
  });
});

describe("agent wallets", () => {
  const trading = {
    id: "6f1c2b8e-0000-4000-8000-000000000001",
    name: "Trading",
    paused: false,
    archived_at: null,
    app: null,
    last_used_at: 1_760_000_100,
    created_at: 1_760_000_000,
    addresses: [
      { family: "evm", address: agent.address, wallet_id: "w_12" },
      { family: "svm", address: "B4KZ1111", wallet_id: "w_13" },
    ],
    connections: [{ key: "oauth:c1", label: "Claude Code", lane: "aomi" }],
  };
  const world = {
    ...trading,
    id: "6f1c2b8e-0000-4000-8000-000000000002",
    name: "World",
    paused: true,
    archived_at: 1_760_000_200,
    app: { id: 90, name: "world" },
    last_used_at: null,
    addresses: [{ family: "evm", address: "0x41c2", wallet_id: "w_31" }],
    connections: [{ key: "telegram:42", lane: "instant" }],
  };

  it("lists, creates, updates and withdraws with portal CSRF on writes", async () => {
    const { client, calls } = backend({
      "GET /v1/account/agent-wallets": () =>
        Response.json({
          pause_all: true,
          wallets: [trading, world],
        }),
      "POST /v1/account/agent-wallets": () => Response.json(trading),
      [`PATCH /v1/account/agent-wallets/${trading.id}`]: () =>
        Response.json({ ...trading, paused: true }),
      [`GET /v1/account/agent-wallets/${trading.id}/balances`]: () =>
        Response.json({
          networks: [
            {
              chain_id: 8453,
              name: "Base",
              usd_total: "412.18",
              assets: [
                {
                  token: "native",
                  symbol: "ETH",
                  decimals: 18,
                  amount: "0.0312",
                  usd: "99.78",
                },
              ],
            },
            { chain_id: 1, name: "Ethereum", assets: [], error: true },
          ],
        }),
      [`POST /v1/account/agent-wallets/${trading.id}/withdraw`]: () =>
        Response.json({ ref: "c_1" }),
    });
    const wallets = client.account.wallets;

    const listed = await wallets.agentWallets();
    expect(listed.pause_all).toBe(true);
    expect(listed.wallets[0]).toEqual(trading);
    expect(listed.wallets[1]).toMatchObject({
      archived_at: 1_760_000_200,
      app: { id: 90, name: "world", label: "world" },
      connections: [
        { key: "telegram:42", label: "telegram:42", lane: "instant" },
      ],
    });

    await wallets.createAgentWallet({ name: "Trading", connection_key: "cli" });
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      body: { name: "Trading", connection_key: "cli" },
    });
    expect(calls.at(-1)!.headers.get("x-aomi-csrf")).toBe("1");

    expect(
      (await wallets.updateAgentWallet(trading.id, { paused: true })).paused,
    ).toBe(true);
    expect(calls.at(-1)).toMatchObject({
      method: "PATCH",
      body: { paused: true },
    });

    const balances = await wallets.agentWalletBalances(trading.id, "evm");
    expect(balances.networks.map((n) => [n.name, n.error])).toEqual([
      ["Base", false],
      ["Ethereum", true],
    ]);

    const withdraw = {
      family: "evm" as const,
      chain_id: 8453,
      to: "0x80c4",
      assets: [{ token: "native", amount: "max" }],
    };
    expect(await wallets.withdrawAgentWallet(trading.id, withdraw)).toEqual({
      ref: "c_1",
    });
    expect(calls.at(-1)).toMatchObject({ method: "POST", body: withdraw });
  });

  it("asks for one family's balances", async () => {
    const seen: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(new URL(String(input)).search);
      return Response.json({ networks: [] });
    }) as typeof globalThis.fetch;
    const client = new AomiClient({
      baseUrl: "https://api.example",
      guest: false,
      fetch,
    });
    await client.account.wallets.agentWalletBalances("g", "svm");
    expect(seen).toEqual(["?family=svm"]);
  });

  it("keeps agent_wallet_busy for an archive with a trade in flight", async () => {
    const { client } = backend({
      [`PATCH /v1/account/agent-wallets/${trading.id}`]: () =>
        Response.json({ error: "agent_wallet_busy" }, { status: 409 }),
    });
    await expect(
      client.account.wallets.updateAgentWallet(trading.id, { archived: true }),
    ).rejects.toMatchObject({
      status: 409,
      code: WALLET_ERROR_CODES.agentWalletBusy,
    });
  });
});

describe("commit wallet refusals", () => {
  it("keeps the backend's flat wallet fields as the error's details", () => {
    const body = {
      code: "commit_wallet_paused",
      agent_wallet_id: "g-1",
      wallet_name: "Hoodit",
      connection_key: "telegram:77",
    };
    const error = commitRefError(403, "Forbidden", body);
    expect(error).toMatchObject({ status: 403, code: "commit_wallet_paused" });
    expect(error.details).toEqual(body);
    // api-server's nested shape keeps its own details.
    expect(
      commitRefError(403, "", {
        error: {
          code: "commit_wallet_paused",
          details: { agent_wallet_id: "g-2" },
        },
      }).details,
    ).toEqual({ agent_wallet_id: "g-2" });
  });
});

describe("pause all", () => {
  it("writes pause all with portal CSRF", async () => {
    const { fetch, calls } = backend({
      "PUT /v1/account/pause-all": () => Response.json({ pause_all: true }),
    });
    const aomi = new Aomi({
      baseUrl: "https://api.example",
      guest: false,
      fetch,
    });
    expect(await aomi.wallets.pauseAll(true)).toEqual({ pause_all: true });
    expect(calls.at(-1)).toMatchObject({
      method: "PUT",
      path: "/v1/account/pause-all",
      body: { paused: true },
    });
    expect(calls.at(-1)!.headers.get("x-aomi-csrf")).toBe("1");
  });
});

describe("connections", () => {
  it("lists connections, writes one's settings and removes an OAuth client", async () => {
    const { client, calls } = backend({
      "GET /v1/account/connections": () =>
        Response.json({
          connections: [
            {
              key: "portal",
              kind: "portal",
              name: "Aomi",
              detail: null,
              application: null,
              ask_only: false,
              wallets: [],
              last_used_at: null,
              connected_at: null,
              removable: false,
            },
            {
              key: "telegram:7712345678",
              kind: "telegram",
              name: "@HooditBot",
              detail: "Telegram @arixon",
              application: { id: 86, name: "hoodit", label: "Hoodit" },
              ask_only: true,
              wallets: [
                { id: "g-1", name: "Hoodit", lane: "instant", archived: true },
              ],
              last_used_at: 1_760_400_000,
              connected_at: null,
              removable: false,
            },
            { key: "oauth:c1", kind: "ai", name: "Claude", removable: true },
            { key: "mystery", kind: "robot", name: "Dropped" },
          ],
        }),
      "PUT /v1/account/connection-settings/oauth%3Ac1": () =>
        Response.json({
          key: "oauth:c1",
          label: "Laptop",
          last_used_at: null,
        }),
      "PUT /v1/account/connections/oauth%3Ac1/wallets": (body) =>
        Response.json(body),
      "DELETE /v1/account/connections/oauth/c1": () =>
        Response.json({ revoked: true }),
    });
    const { connections } = await client.account.connections.list();
    expect(connections.map((row) => row.key)).toEqual([
      "portal",
      "telegram:7712345678",
      "oauth:c1",
    ]);
    expect(connections[1]).toMatchObject({
      detail: "Telegram @arixon",
      application: { id: 86, name: "hoodit", label: "Hoodit" },
      ask_only: true,
      wallets: [{ id: "g-1", name: "Hoodit", lane: "instant", archived: true }],
    });
    expect(connections[2]).toMatchObject({
      application: null,
      ask_only: false,
      wallets: [],
      last_used_at: null,
      removable: true,
    });

    expect(
      await client.account.connections.setConnectionSettings("oauth:c1", {
        label: "Laptop",
      }),
    ).toEqual({
      key: "oauth:c1",
      label: "Laptop",
      last_used_at: null,
    });
    expect(calls.at(-1)).toMatchObject({
      method: "PUT",
      body: { label: "Laptop" },
    });

    const update = {
      wallets: [{ id: "g-1", lane: "aomi" }],
      application: "world",
      new_app_wallet: { lane: "aomi" },
      ask_only: true,
    };
    expect(
      await client.account.connections.setConnectionWallets("oauth:c1", update),
    ).toEqual({
      ask_only: true,
      wallets: [{ id: "g-1", name: "", lane: "aomi", archived: false }],
    });
    expect(calls.at(-1)).toMatchObject({
      method: "PUT",
      path: "/v1/account/connections/oauth%3Ac1/wallets",
      body: update,
    });
    expect(calls.at(-1)!.headers.get("x-aomi-csrf")).toBe("1");

    await client.account.connections.disconnectOAuth("c1");
    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      path: "/v1/account/connections/oauth/c1",
    });
    expect(calls.at(-1)!.headers.get("x-aomi-csrf")).toBe("1");
  });
});

describe("Telegram link (step 5)", () => {
  const code = "A".repeat(42) + "_";
  const preview = {
    telegram: {
      username: "arixon",
      bots: [{ bot_id: "7712345678", label: "@HooditBot" }],
      linked_from: { bot_id: "7712345678", label: "@HooditBot" },
    },
    account: { label: "arixon.ethereum@gmail.com" },
    survivor: "this_account",
    moves: {
      agent_wallets: [
        {
          id: "w_31",
          family: "evm",
          address: "0x7a3f…c41e",
          label: "Agent wallet",
          total_usd: "95.10",
          becomes: "extra",
        },
      ],
      chats_in_bots: 3,
      scheduled_jobs: 1,
      pending_trades: { cancel: 1, wait: 0 },
      world: [{ bot: "@WorldMarketsBot", state: "active" }],
    },
    expires_at: 1_760_401_000,
  };

  it("previews, confirms and cancels with the code in a CSRF-marked body", async () => {
    const result = {
      linked: true,
      telegram: { username: "arixon" },
      wallets: [
        { id: "w_12", address: "0x91c0…", role: "default" },
        { id: "w_31", address: "0x7a3f…", role: "extra" },
      ],
      cancelled: 1,
      moved: { chats: 3, wallets: 2 },
    };
    const { client, calls } = backend({
      "POST /v1/account/link/telegram/preview": () => Response.json(preview),
      "POST /v1/account/link/telegram/confirm": () => Response.json(result),
      "POST /v1/account/link/telegram/cancel": () =>
        Response.json({ cancelled: true }),
    });
    const link = client.account.telegramLink;
    expect(await link.previewTelegramLink(code)).toEqual(preview);
    expect(await link.confirmTelegramLink(code)).toEqual({
      ...result,
      wallets: [
        {
          id: "w_12",
          address: "0x91c0…",
          role: "default",
        },
        { id: "w_31", address: "0x7a3f…", role: "extra" },
      ],
    });
    await link.cancelTelegramLink(code);
    expect(calls.map((call) => [call.path, call.body])).toEqual([
      ["/v1/account/link/telegram/preview", { code }],
      ["/v1/account/link/telegram/confirm", { code }],
      ["/v1/account/link/telegram/cancel", { code }],
    ]);
    for (const call of calls) {
      expect(call.method).toBe("POST");
      expect(call.headers.get("x-aomi-csrf")).toBe("1");
    }
  });

  it("keeps the error code and its extras", async () => {
    const { client } = backend({
      "POST /v1/account/link/telegram/confirm": () =>
        Response.json(
          {
            error: "account_link_busy",
            in_flight: [
              {
                id: "c-1",
                state: "submitted",
                chain: "8453",
                transaction_url: null,
              },
            ],
          },
          { status: 409 },
        ),
      "POST /v1/account/link/telegram/preview": () =>
        Response.json(
          { error: "telegram_already_linked", same_account: true },
          { status: 409 },
        ),
    });
    const busy = await client.account.telegramLink
      .confirmTelegramLink(code)
      .catch((error: unknown) => error);
    expect(busy).toBeInstanceOf(TelegramLinkError);
    expect(busy).toMatchObject({
      status: 409,
      code: "account_link_busy",
      error: "account_link_busy",
    });
    expect((busy as TelegramLinkError).inFlight).toEqual([
      { id: "c-1", state: "submitted", chain: "8453", transaction_url: null },
    ]);
    const linked = await client.account.telegramLink
      .previewTelegramLink(code)
      .catch((error: unknown) => error);
    expect((linked as TelegramLinkError).sameAccount).toBe(true);
    expect((linked as TelegramLinkError).extras).toEqual({
      same_account: true,
    });
  });

  it("knows a well-formed code", () => {
    expect(isTelegramLinkCode(code)).toBe(true);
    expect(isTelegramLinkCode(code.slice(1))).toBe(false);
    expect(isTelegramLinkCode(`${code.slice(1)}=`)).toBe(false);
    expect(isTelegramLinkCode(undefined)).toBe(false);
  });
});
