import { describe, expect, it, vi } from "vitest";
import { AomiClient } from "../client";
import {
  RULES_ERROR_CODES,
  hasRules,
  parseRuleChange,
  parseWalletRules,
  type AomiWalletRules,
} from "./rules";
import { AomiWalletError } from "./wallets";

const WALLET = "6f1c2b8e-0000-4000-8000-000000000001";
const CHANGE = "9a000000-0000-4000-8000-000000000009";
const USDC = "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SOL = "solana:mainnet-beta/native";

const NO_RULES = { apps: null, limits: [], not_after: null, owner_only: false };

const change = {
  id: CHANGE,
  agent_wallet_id: WALLET,
  wallet_name: "Trading wallet",
  lines: [{ text: "USDC on Base: 200 → 400 a day", loosens: true }],
  state: "awaiting_admin",
  proposed_by: "agent:telegram:7712345678",
  expires_at: 1795100000,
  signer: null,
  sign_message: null,
};
const body = {
  agent_wallet_id: WALLET,
  wallet_name: "Trading wallet",
  revision: 3,
  rules: {
    apps: ["jupiter", "kamino", "uniswap"],
    limits: [
      { asset: SOL, amount: "500000000", symbol: "SOL", decimals: 9 },
      { asset: USDC, amount: "200000000", symbol: "USDC", decimals: 6 },
    ],
    not_after: 1795219200,
    owner_only: true,
  },
  sentences: [
    "Can use Jupiter, Kamino, Uniswap",
    "Up to 0.5 SOL a day on Solana",
  ],
  admin: { kind: "aomi_managed" },
  stopped_until: null,
  usage: [
    {
      asset: SOL,
      used: "200000000",
      cap: "500000000",
      symbol: "SOL",
      decimals: 9,
    },
  ],
  window_ends_at: 1795046400,
  pending: null,
  enforcement: [
    {
      provider: "swig",
      name: "Swig",
      network: "solana:mainnet-beta",
      state: "behind",
      covers: {
        apps: ["jupiter", "kamino"],
        limits: [SOL],
        not_after: false,
        owner_only: false,
      },
      left: { [SOL]: "300000000" },
      note: "Your rules changed since you signed.",
      ready: true,
      signer: { family: "svm", address: "HZpj1111" },
    },
  ],
  admin_wallets: [{ kind: "wallet", family: "svm", address: "HZpj1111" }],
};

function backend(routes: Record<string, (body: unknown) => Response>) {
  const calls: {
    method: string;
    path: string;
    headers: Headers;
    body: unknown;
  }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const sent = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      path: url.pathname,
      headers: new Headers(init?.headers),
      body: sent,
    });
    const route = routes[`${method} ${url.pathname}`];
    return route
      ? route(sent)
      : Response.json({ error: "unexpected" }, { status: 500 });
  }) as typeof globalThis.fetch;
  return {
    rules: new AomiClient({
      baseUrl: "https://api.example",
      guest: false,
      fetch,
    }).account.rules,
    calls,
  };
}

describe("wallet rules", () => {
  it("reads a wallet's rules, usage, admin and admin wallets", async () => {
    const { rules, calls } = backend({
      [`GET /v1/account/agent-wallets/${WALLET}/rules`]: () =>
        Response.json(body),
    });
    const read = await rules.get(WALLET);
    expect(read).toEqual(body satisfies AomiWalletRules);
    expect(calls[0]!.headers.has("x-aomi-csrf")).toBe(false);
  });

  it("reads a wallet that never had rules, filling what the server left out", () => {
    expect(
      parseWalletRules({
        agent_wallet_id: WALLET,
        wallet_name: "New",
        revision: 0,
        admin: { kind: "aomi_managed" },
      }),
    ).toEqual({
      agent_wallet_id: WALLET,
      wallet_name: "New",
      revision: 0,
      rules: NO_RULES,
      sentences: [],
      admin: { kind: "aomi_managed" },
      stopped_until: null,
      usage: [],
      window_ends_at: null,
      pending: null,
      enforcement: [],
      admin_wallets: [],
    });
  });

  it("prepares and confirms putting the rules on chain, by provider id", async () => {
    const step = `/v1/account/agent-wallets/${WALLET}/rules/enforcement/swig`;
    const action = {
      kind: "transaction",
      family: "svm",
      network: "solana:mainnet-beta",
      unsigned_base64: "dHg=",
    };
    const { rules, calls } = backend({
      [`POST ${step}/prepare`]: () => Response.json({ action }),
      [`POST ${step}/confirm`]: () => Response.json({ rules: body }),
    });
    const request = {
      network: "solana:mainnet-beta",
      revision: 4,
      owner: "HZpj1111",
    };
    expect(await rules.prepareEnforcement(WALLET, "swig", request)).toEqual(
      action,
    );
    expect(await rules.confirmEnforcement(WALLET, "swig", request)).toEqual(
      body,
    );
    expect(calls.map((call) => call.body)).toEqual([request, request]);
    expect(calls[0]!.headers.get("x-aomi-csrf")).toBe("1");
  });

  it("reads no action when the chain already holds the rules, and refuses an unknown state or action", async () => {
    const step = `/v1/account/agent-wallets/${WALLET}/rules/enforcement/swig`;
    const request = { network: "solana:mainnet-beta", revision: 4 };
    const { rules } = backend({
      [`POST ${step}/prepare`]: () => Response.json({ action: null }),
    });
    expect(await rules.prepareEnforcement(WALLET, "swig", request)).toBeNull();
    const later = backend({
      [`POST ${step}/prepare`]: () =>
        Response.json({ action: { kind: "typed_data" } }),
    });
    await expect(
      later.rules.prepareEnforcement(WALLET, "swig", request),
    ).rejects.toThrow(/unsupported action: typed_data/);
    expect(() =>
      parseWalletRules({
        ...body,
        enforcement: [{ ...body.enforcement[0], state: "paused" }],
      }),
    ).toThrow(/unsupported enforcement state/);
  });

  it("keeps amounts beyond 2^53 as strings and an unknown token's null symbol", () => {
    const huge = "123456789012345678901234567890";
    const read = parseWalletRules({
      ...body,
      rules: {
        ...NO_RULES,
        limits: [{ asset: USDC, amount: huge, symbol: null }],
      },
      usage: [{ asset: USDC, used: huge, cap: huge, symbol: null }],
    });
    expect(read.rules.limits[0]).toEqual({
      asset: USDC,
      amount: huge,
      symbol: null,
      decimals: null,
    });
    expect(read.usage[0]).toMatchObject({ used: huge, symbol: null });
  });

  it.each([
    ["a rule it does not know", { rules: { ...NO_RULES, gas_cap: "5" } }],
    ["the old list of rules", { rules: [{ kind: "recipient_is_owner" }] }],
    [
      "a numeric amount",
      { rules: { ...NO_RULES, limits: [{ asset: USDC, amount: 5 }] } },
    ],
    [
      "an amount that is not digits",
      { rules: { ...NO_RULES, limits: [{ asset: USDC, amount: "1.5" }] } },
    ],
    ["an end date that is not a number", { rules: { not_after: "soon" } }],
    ["a flag that is not a boolean", { rules: { owner_only: "yes" } }],
    ["an unknown admin", { admin: { kind: "multisig" } }],
  ])("rejects %s rather than dropping it from the next write", (_, extra) => {
    expect(() => parseWalletRules({ ...body, ...extra })).toThrow(
      /Invalid rules response/,
    );
  });

  it("reads no rules and tells them from a wallet with one", () => {
    const none = parseWalletRules({ ...body, rules: NO_RULES }).rules;
    expect(none).toEqual(NO_RULES);
    expect(hasRules(none)).toBe(false);
    expect(hasRules({ ...none, apps: [] })).toBe(true);
    expect(hasRules({ ...none, owner_only: true })).toBe(true);
  });

  it("changes rules with CSRF, sending only asset and amount for a limit", async () => {
    const { rules, calls } = backend({
      [`POST /v1/account/agent-wallets/${WALLET}/rules`]: () =>
        Response.json({
          status: "waiting",
          rules: { ...body, pending: change },
        }),
    });
    const read = parseWalletRules(body);
    const result = await rules.change(WALLET, { rules: read.rules });
    expect(calls[0]!.headers.get("x-aomi-csrf")).toBe("1");
    expect(calls[0]!.body).toEqual({
      rules: {
        apps: ["jupiter", "kamino", "uniswap"],
        limits: [
          { asset: SOL, amount: "500000000" },
          { asset: USDC, amount: "200000000" },
        ],
        not_after: 1795219200,
        owner_only: true,
      },
    });
    expect(result.status).toBe("waiting");
    expect(result.rules.pending).toEqual(change);
  });

  it("changes the admin or Instant connections without touching the rules", async () => {
    const { rules, calls } = backend({
      [`POST /v1/account/agent-wallets/${WALLET}/rules`]: () =>
        Response.json({ status: "unchanged", rules: body }),
    });
    await rules.change(WALLET, {
      admin: { kind: "wallet", family: "svm", address: "HZpj1111" },
    });
    await rules.change(WALLET, { instant: ["telegram:7712345678"] });
    expect(calls.map((call) => call.body)).toEqual([
      { admin: { kind: "wallet", family: "svm", address: "HZpj1111" } },
      { instant: ["telegram:7712345678"] },
    ]);
  });

  it("reads the catalog of apps and tokens", async () => {
    const catalog = {
      apps: [
        {
          id: "uniswap",
          label: "Uniswap",
          chains: ["eip155:1", "eip155:8453"],
        },
      ],
      tokens: [{ asset: USDC, symbol: "USDC", decimals: 6, chain: "Base" }],
    };
    const { rules } = backend({
      "GET /v1/account/rules/catalog": () => Response.json(catalog),
    });
    expect(await rules.catalog()).toEqual(catalog);
  });

  it("reads a change and the wallet that must sign it", async () => {
    const signed = {
      ...change,
      signer: { kind: "wallet", family: "evm", address: "0xAdmin" },
      sign_message: "Aomi rule change",
    };
    const { rules } = backend({
      [`GET /v1/account/rule-changes/${CHANGE}`]: () => Response.json(signed),
    });
    expect(await rules.getChange(CHANGE)).toEqual(signed);
    expect(() => parseRuleChange({ ...change, state: "paused" })).toThrow(
      /unsupported change state/,
    );
  });

  it("approves with an empty body or a signature, and declines", async () => {
    const { rules, calls } = backend({
      [`POST /v1/account/rule-changes/${CHANGE}/approve`]: () =>
        Response.json(body),
      [`POST /v1/account/rule-changes/${CHANGE}/decline`]: () =>
        Response.json(body),
    });
    await rules.approveChange(CHANGE);
    await rules.approveChange(CHANGE, { signature: "0xsigned" });
    expect((await rules.declineChange(CHANGE)).revision).toBe(3);
    expect(calls.map((call) => call.body)).toEqual([
      {},
      { signature: "0xsigned" },
      {},
    ]);
    expect(calls.every((call) => call.headers.get("x-aomi-csrf") === "1")).toBe(
      true,
    );
  });

  it.each([
    [403, RULES_ERROR_CODES.loginStale],
    [403, RULES_ERROR_CODES.signatureRequired],
    [409, RULES_ERROR_CODES.changeNotOpen],
    [409, RULES_ERROR_CODES.changed],
    [404, RULES_ERROR_CODES.changeNotFound],
  ])("raises %i %s as a typed error", async (status, code) => {
    const { rules } = backend({
      [`POST /v1/account/rule-changes/${CHANGE}/approve`]: () =>
        Response.json({ error: code }, { status }),
    });
    const error = await rules.approveChange(CHANGE).catch((caught) => caught);
    expect(error).toBeInstanceOf(AomiWalletError);
    expect(error).toMatchObject({ status, code });
  });
});
