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

const NO_RULES = { mode: "blacklist", rules: [], linked_only: false };
const SOL_RULE = `${SOL}@protocol:jupiter`;
const USDC_RULE = `${USDC}@any`;

const change = {
  id: CHANGE,
  agent_wallet_id: WALLET,
  wallet_name: "Trading wallet",
  lines: [{ text: "USDC on Base: 200 → 400", loosens: true }],
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
    mode: "whitelist",
    rules: [
      {
        id: SOL_RULE,
        asset: SOL,
        amount: "500000000",
        to: { kind: "protocol", id: "jupiter" },
        active_from: 1795000000,
        active_until: 1797600000,
        symbol: "SOL",
        decimals: 9,
      },
      {
        id: USDC_RULE,
        asset: USDC,
        amount: "200000000",
        to: { kind: "any_protocol" },
        active_from: 1795000000,
        symbol: "USDC",
        decimals: 6,
      },
    ],
    linked_only: true,
  },
  sentences: [
    "Whitelist: only what is listed is allowed",
    "Up to 0.5 SOL on Jupiter (Solana)",
  ],
  admin: { kind: "aomi_managed" },
  stopped_until: null,
  pending: null,
  enforced_by: { [SOL_RULE]: ["Aomi"], [USDC_RULE]: ["Aomi"] },
  enforcement: [
    {
      rule: SOL_RULE,
      provider: "swig",
      name: "Swig",
      network: "solana:mainnet-beta",
      state: "behind",
      ready: true,
      left: "300000000",
      expires_at: 1797600600,
      account: "SwigWallet111",
      deployment_tx: "5igTx",
      note: "Your rules changed since you signed.",
      signer: { family: "svm", address: "HZpj1111" },
    },
    {
      rule: USDC_RULE,
      provider: "metamask",
      name: "MetaMask",
      network: "eip155:8453",
      state: "off",
      ready: true,
      left: null,
      expires_at: null,
      account: null,
      deployment_tx: null,
      note: null,
      signer: { family: "evm", address: null },
    },
  ],
  providers: [
    {
      provider: "swig",
      name: "Swig",
      network: "solana:mainnet-beta",
      holds: "total_period_and_destination",
      note: "Holds a rule's total, its end and where it may go.",
    },
    {
      provider: "metamask",
      name: "MetaMask",
      network: "eip155:8453",
      holds: "total_and_period",
      note: null,
    },
  ],
  vaults: [
    {
      provider: "metamask",
      network: "eip155:8453",
      address: "0xf140e63cd8cfd832980b7214c6394f0974112b3d",
      owner: "0x321d02a5fb29e85d7431d8a0ee70df9e5e7ebd4f",
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
  it("reads a wallet's rules with their periods, admin and admin wallets", async () => {
    const { rules, calls } = backend({
      [`GET /v1/account/agent-wallets/${WALLET}/rules`]: () =>
        Response.json(body),
    });
    const read = await rules.get(WALLET);
    expect(read).toEqual(body satisfies AomiWalletRules);
    // An always-on rule has no end, and nothing counts spend any more.
    expect(read.rules.rules[1]).not.toHaveProperty("active_until");
    expect(read).not.toHaveProperty("usage");
    expect(read).not.toHaveProperty("window_ends_at");
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
      pending: null,
      enforced_by: {},
      enforcement: [],
      providers: [],
      vaults: [],
      admin_wallets: [],
    });
  });

  it("prepares and confirms one rule's transaction, by provider id", async () => {
    const step = `/v1/account/agent-wallets/${WALLET}/rules/enforcement/swig`;
    const action = {
      kind: "transaction",
      network: "solana:mainnet-beta",
      unsigned_base64: "dHg=",
    };
    const { rules, calls } = backend({
      [`POST ${step}/prepare`]: () => Response.json({ action }),
      [`POST ${step}/confirm`]: () => Response.json({ rules: body }),
    });
    const request = {
      network: "solana:mainnet-beta",
      rule: SOL_RULE,
      revision: 4,
      owner: "HZpj1111",
    };
    expect(await rules.prepareEnforcement(WALLET, "swig", request)).toEqual(
      action,
    );
    expect(await rules.confirmEnforcement(WALLET, "swig", request)).toEqual(
      body,
    );
    // The rule goes in the body; a transaction's confirm sends no signature.
    expect(calls.map((call) => call.body)).toEqual([request, request]);
    expect(calls[0]!.headers.get("x-aomi-csrf")).toBe("1");
  });

  it("prepares typed data to sign, and confirms with the signature", async () => {
    const step = `/v1/account/agent-wallets/${WALLET}/rules/enforcement/metamask`;
    const typed_data = {
      domain: { name: "Delegation", chainId: 8453, salt: "0x01" },
      types: {
        Delegation: [
          { name: "delegate", type: "address" },
          { name: "cap", type: "uint256" },
        ],
      },
      primaryType: "Delegation",
      // Above 2^53, so a decimal string.
      message: { delegate: "0xAgent", cap: "123456789012345678901234567890" },
    };
    const { rules, calls } = backend({
      [`POST ${step}/prepare`]: () =>
        Response.json({
          action: { kind: "typed_data", network: "eip155:8453", typed_data },
        }),
      [`POST ${step}/confirm`]: () => Response.json({ rules: body }),
    });
    const request = {
      network: "eip155:8453",
      rule: USDC_RULE,
      revision: 4,
    };
    expect(await rules.prepareEnforcement(WALLET, "metamask", request)).toEqual(
      { kind: "typed_data", network: "eip155:8453", typed_data },
    );
    await rules.confirmEnforcement(WALLET, "metamask", {
      ...request,
      signature: "0xabc123",
    });
    expect(calls.map((call) => call.body)).toEqual([
      request,
      { ...request, signature: "0xabc123" },
    ]);
  });

  it("prepares a plain transaction for the owner to send, and confirms with no signature", async () => {
    const step = `/v1/account/agent-wallets/${WALLET}/rules/enforcement/metamask`;
    const action = {
      kind: "evm_transaction",
      network: "eip155:8453",
      to: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
      data: "0xcafe0001",
      value: "0x0",
    };
    const { rules, calls } = backend({
      [`POST ${step}/prepare`]: () => Response.json({ action }),
      [`POST ${step}/confirm`]: () => Response.json({ rules: body }),
    });
    const request = { network: "eip155:8453", rule: USDC_RULE, revision: 4 };
    expect(await rules.prepareEnforcement(WALLET, "metamask", request)).toEqual(
      action,
    );
    await rules.confirmEnforcement(WALLET, "metamask", request);
    // The send needs nothing of the wallet's but the transaction itself.
    expect(calls.map((call) => call.body)).toEqual([request, request]);
  });

  it("reads an evm_transaction strictly: hex to, data and value, and an eip155 network", async () => {
    const step = `/v1/account/agent-wallets/${WALLET}/rules/enforcement/metamask`;
    const request = { network: "eip155:8453", rule: USDC_RULE, revision: 4 };
    const sound = {
      kind: "evm_transaction",
      network: "eip155:8453",
      to: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
      data: "0x",
      value: "0x0",
    };
    const answering = (action: Record<string, unknown>) =>
      backend({
        [`POST ${step}/prepare`]: () => Response.json({ action }),
      }).rules.prepareEnforcement(WALLET, "metamask", request);
    // Empty calldata and a large quantity are fine.
    await expect(
      answering({ ...sound, value: "0xde0b6b3a7640000" }),
    ).resolves.toMatchObject({ kind: "evm_transaction", data: "0x" });
    for (const [change, message] of [
      [{ network: "solana:mainnet-beta" }, /action.network must be eip155/],
      [{ network: "eip155:base" }, /action.network must be eip155/],
      [{ network: "eip155:0" }, /action.network must be eip155/],
      [{ to: undefined }, /action.to must be a string/],
      [
        { to: "db9b1e94b5b69df7e401ddbede43491141047db3" },
        /action.to must be a 20-byte/,
      ],
      [
        { to: "0xdb9b1e94b5b69df7e401ddbede43491141047d" },
        /action.to must be a 20-byte/,
      ],
      [
        { to: "0xdb9b1e94b5b69df7e401ddbede43491141047dbz" },
        /action.to must be a 20-byte/,
      ],
      [{ data: undefined }, /action.data must be a string/],
      [{ data: "cafe" }, /action.data must be 0x hex/],
      [{ data: "0xcaf" }, /action.data must be 0x hex/],
      [{ data: "0xzz" }, /action.data must be 0x hex/],
      [{ value: undefined }, /action.value must be a string/],
      [{ value: "0" }, /action.value must be a 0x hex quantity/],
      [{ value: "0x" }, /action.value must be a 0x hex quantity/],
      [{ value: "0x00" }, /action.value must be a 0x hex quantity/],
      [{ value: "1000" }, /action.value must be a 0x hex quantity/],
    ] as const) {
      await expect(answering({ ...sound, ...change })).rejects.toThrow(message);
    }
  });

  it("reads no action when the chain already shows the rule, and refuses an unknown state, kind or malformed action", async () => {
    const step = `/v1/account/agent-wallets/${WALLET}/rules/enforcement/swig`;
    const request = {
      network: "solana:mainnet-beta",
      rule: SOL_RULE,
      revision: 4,
    };
    const { rules } = backend({
      [`POST ${step}/prepare`]: () => Response.json({ action: null }),
    });
    expect(await rules.prepareEnforcement(WALLET, "swig", request)).toBeNull();
    const answering = (action: unknown) =>
      backend({
        [`POST ${step}/prepare`]: () => Response.json({ action }),
      }).rules.prepareEnforcement(WALLET, "swig", request);
    // A kind this client does not know is refused, not guessed at.
    await expect(
      answering({ kind: "user_op", network: "eip155:8453" }),
    ).rejects.toThrow(/unsupported action: user_op/);
    await expect(answering({ kind: "typed_data" })).rejects.toThrow(
      /action.network must be a string/,
    );
    await expect(
      answering({ kind: "typed_data", network: "eip155:8453" }),
    ).rejects.toThrow(/needs a domain, types and a message/);
    await expect(
      answering({
        kind: "typed_data",
        network: "eip155:8453",
        typed_data: {
          domain: {},
          types: { Delegation: [{ name: "cap" }] },
          primaryType: "Delegation",
          message: {},
        },
      }),
    ).rejects.toThrow(/field type must be a string/);
    expect(() =>
      parseWalletRules({
        ...body,
        enforcement: [{ ...body.enforcement[0], state: "paused" }],
      }),
    ).toThrow(/unsupported enforcement state/);
  });

  it("reads each entry per rule, with what is left and the end read from the chain", () => {
    const [swig, metamask] = parseWalletRules(body).enforcement;
    expect(swig).toEqual(body.enforcement[0]);
    expect(metamask).toEqual(body.enforcement[1]);
    // The fields a grant has no value for may be left out.
    const { rule, provider, name, network, state, ready, signer } =
      body.enforcement[1]!;
    expect(
      parseWalletRules({
        ...body,
        enforcement: [
          {
            rule,
            provider,
            name,
            network,
            state,
            ready,
            signer: { family: "evm" },
          },
        ],
      }).enforcement,
    ).toEqual([
      {
        ...body.enforcement[1],
        signer: { family: "evm", address: null },
      },
    ]);
    // An entry names its rule, and what is left is base units, never a number.
    expect(() =>
      parseWalletRules({
        ...body,
        enforcement: [{ ...body.enforcement[0], rule: undefined }],
      }),
    ).toThrow(/enforcement.rule must be a string/);
    expect(() =>
      parseWalletRules({
        ...body,
        enforcement: [{ ...body.enforcement[0], left: 300000000 }],
      }),
    ).toThrow(/enforcement.left must be a string/);
    expect(() =>
      parseWalletRules({
        ...body,
        enforcement: [{ ...body.enforcement[0], expires_at: "soon" }],
      }),
    ).toThrow(/enforcement.expires_at must be a number/);
  });

  it("reads the providers that could hold the rules, and refuses a hold it does not know", () => {
    expect(parseWalletRules(body).providers).toEqual(body.providers);
    // A backend from before the field sends none; the note may be left out.
    const { providers: _omitted, ...older } = body;
    expect(parseWalletRules(older).providers).toEqual([]);
    const { note: _note, ...bare } = body.providers[1]!;
    expect(parseWalletRules({ ...body, providers: [bare] }).providers).toEqual([
      { ...bare, note: null },
    ]);
    expect(() =>
      parseWalletRules({
        ...body,
        providers: [{ ...body.providers[0], holds: "everything" }],
      }),
    ).toThrow(/unsupported provider holds/);
    expect(() =>
      parseWalletRules({
        ...body,
        providers: [{ ...body.providers[0], network: 8453 }],
      }),
    ).toThrow(/providers.network must be a string/);
  });

  it("reads the owner's vaults, kept with no rule on chain, and refuses a malformed one", () => {
    // The last grant is revoked: nothing is held, and the vault is still listed.
    const revoked = { ...body, enforcement: [], enforced_by: {} };
    expect(parseWalletRules(revoked).vaults).toEqual(body.vaults);
    // A backend from before the field sends none.
    const { vaults: _omitted, ...older } = body;
    expect(parseWalletRules(older).vaults).toEqual([]);
    const { owner: _owner, ...ownerless } = body.vaults[0]!;
    expect(() => parseWalletRules({ ...body, vaults: [ownerless] })).toThrow(
      /vaults.owner must be a string/,
    );
    expect(() => parseWalletRules({ ...body, vaults: {} })).toThrow(
      /vaults must be an array/,
    );
  });

  it("keeps amounts beyond 2^53 as strings and an unknown token's null symbol", () => {
    const huge = "123456789012345678901234567890";
    const read = parseWalletRules({
      ...body,
      rules: {
        ...NO_RULES,
        rules: [
          {
            asset: USDC,
            amount: huge,
            to: { kind: "any_protocol" },
            symbol: null,
          },
        ],
      },
    });
    // A rule the server sent no id for gets the key it would have.
    expect(read.rules.rules[0]).toEqual({
      id: USDC_RULE,
      asset: USDC,
      amount: huge,
      to: { kind: "any_protocol" },
      symbol: null,
      decimals: null,
    });
  });

  it.each([
    ["a rule it does not know", { rules: { ...NO_RULES, gas_cap: "5" } }],
    ["the old list of rules", { rules: [{ kind: "recipient_is_owner" }] }],
    [
      "a numeric amount",
      {
        rules: {
          ...NO_RULES,
          rules: [{ asset: USDC, amount: 5, to: { kind: "any_protocol" } }],
        },
      },
    ],
    [
      "an amount that is not digits",
      {
        rules: {
          ...NO_RULES,
          rules: [{ asset: USDC, amount: "1.5", to: { kind: "any_protocol" } }],
        },
      },
    ],
    [
      "a destination it does not know",
      {
        rules: {
          ...NO_RULES,
          rules: [{ asset: USDC, amount: "1", to: { kind: "contract" } }],
        },
      },
    ],
    ["the first shape of the rules", { rules: { apps: null, limits: [] } }],
    [
      "a period that is not a number",
      {
        rules: {
          ...NO_RULES,
          rules: [
            {
              asset: USDC,
              amount: "1",
              to: { kind: "any_protocol" },
              active_until: "2026-12-11",
            },
          ],
        },
      },
    ],
    ["a mode it does not know", { rules: { mode: "greylist" } }],
    ["a flag that is not a boolean", { rules: { linked_only: "yes" } }],
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
    expect(hasRules({ ...none, mode: "whitelist" })).toBe(true);
    expect(hasRules({ ...none, linked_only: true })).toBe(true);
  });

  it("changes rules with CSRF, sending a rule's asset, amount, destination and end, never its start", async () => {
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
        mode: "whitelist",
        rules: [
          {
            asset: SOL,
            amount: "500000000",
            to: { kind: "protocol", id: "jupiter" },
            active_until: 1797600000,
          },
          { asset: USDC, amount: "200000000", to: { kind: "any_protocol" } },
        ],
        linked_only: true,
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
    [400, RULES_ERROR_CODES.periodInvalid],
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
