import { describe, expect, it, vi } from "vitest";
import { AomiClient } from "../client";
import {
  POLICY_ERROR_CODES,
  hasPolicies,
  parsePolicyChange,
  parseWalletPolicies,
  type AomiWalletPolicies,
} from "./policy";
import {
  chainOnlyPolicies,
  expectedPolicyAction,
  matchPolicyIds,
  policyOnChain,
} from "./policy-status";
import { AomiWalletError } from "./wallets";

const WALLET = "6f1c2b8e-0000-4000-8000-000000000001";
const CHANGE = "9a000000-0000-4000-8000-000000000009";
const USDC = "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SOL = "solana:mainnet-beta/native";

const NO_RULES = { mode: "blacklist", rules: [], linked_only: false };
const SOL_RULE = `${SOL}@protocol:jupiter`;
const USDC_RULE = `${USDC}@any`;
const withRule = (extra: object) => ({
  ...NO_RULES,
  rules: [{ asset: USDC, amount: "1", to: { kind: "any_protocol" }, ...extra }],
});

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
    "Only allow policy-defined actions: on",
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
    }).account.policy,
    calls,
  };
}

describe("wallet rules", () => {
  it("reads a wallet's rules with their periods, admin and admin wallets", async () => {
    const { rules, calls } = backend({
      [`GET /v1/account/agent-wallets/${WALLET}/policy`]: () =>
        Response.json(body),
    });
    const read = await rules.get(WALLET);
    expect(read).toEqual(body satisfies AomiWalletPolicies);
    expect(calls[0]!.headers.has("x-aomi-csrf")).toBe(false);
  });

  it("reads a wallet that never had rules, filling what the server left out", () => {
    expect(
      parseWalletPolicies({
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
      admin_wallets: [],
    });
  });

  const step = (provider: string) =>
    `/v1/account/agent-wallets/${WALLET}/policy/enforcement/${provider}`;
  const EVM_REQUEST = { network: "eip155:8453", rule: USDC_RULE, revision: 4 };
  const SOL_REQUEST = {
    network: "solana:mainnet-beta",
    rule: SOL_RULE,
    revision: 4,
  };
  const SOUND_TX = {
    kind: "evm_transaction",
    network: "eip155:8453",
    to: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
    data: "0x",
    value: "0x0",
  };
  /** Prepare against a backend that answers `action`. */
  const answering = (action: unknown, provider = "metamask") =>
    backend({
      [`POST ${step(provider)}/prepare`]: () => Response.json({ action }),
    }).rules.prepareEnforcement(
      WALLET,
      provider,
      provider === "swig" ? SOL_REQUEST : EVM_REQUEST,
    );
  const enforcementEntry = (extra: object) => ({
    ...body,
    enforcement: [{ ...body.enforcement[0], ...extra }],
  });

  it("prepares and confirms one rule's transaction, by provider id", async () => {
    const action = {
      kind: "transaction",
      network: "solana:mainnet-beta",
      unsigned_base64: "dHg=",
    };
    const { rules, calls } = backend({
      [`POST ${step("swig")}/prepare`]: () => Response.json({ action }),
      [`POST ${step("swig")}/confirm`]: () => Response.json({ rules: body }),
    });
    const request = { ...SOL_REQUEST, owner: "HZpj1111" };
    expect(await rules.prepareEnforcement(WALLET, "swig", request)).toEqual(
      action,
    );
    expect(await rules.confirmEnforcement(WALLET, "swig", request)).toEqual(
      body,
    );
    // A transaction's confirm sends no signature.
    expect(calls.map((call) => call.body)).toEqual([request, request]);
    expect(calls[0]!.headers.get("x-aomi-csrf")).toBe("1");
  });

  it("prepares typed data to sign, and confirms with the signature", async () => {
    const typed_data = {
      domain: { name: "Delegation", chainId: 8453, salt: "0x01" },
      types: { Delegation: [{ name: "cap", type: "uint256" }] },
      primaryType: "Delegation",
      message: { cap: "123456789012345678901234567890" },
    };
    const action = { kind: "typed_data", network: "eip155:8453", typed_data };
    const { rules, calls } = backend({
      [`POST ${step("metamask")}/prepare`]: () => Response.json({ action }),
      [`POST ${step("metamask")}/confirm`]: () =>
        Response.json({ rules: body }),
    });
    expect(
      await rules.prepareEnforcement(WALLET, "metamask", EVM_REQUEST),
    ).toEqual(action);
    const signed = { ...EVM_REQUEST, signature: "0xabc123" };
    await rules.confirmEnforcement(WALLET, "metamask", signed);
    expect(calls.map((call) => call.body)).toEqual([EVM_REQUEST, signed]);
  });

  it("reads an evm_transaction with empty calldata and a large value", async () => {
    await expect(
      answering({ ...SOUND_TX, value: "0xde0b6b3a7640000" }),
    ).resolves.toEqual({ ...SOUND_TX, value: "0xde0b6b3a7640000" });
  });

  const TO = SOUND_TX.to;
  it.each([
    ["network", "solana:mainnet-beta", "eip155"],
    ["network", "eip155:base", "eip155"],
    ["network", "eip155:0", "eip155"],
    ["to", undefined, "a string"],
    ["to", TO.slice(2), "a 20-byte"],
    ["to", TO.slice(0, -2), "a 20-byte"],
    ["to", `${TO.slice(0, -1)}z`, "a 20-byte"],
    ["data", undefined, "a string"],
    ["data", "cafe", "0x hex"],
    ["data", "0xcaf", "0x hex"],
    ["data", "0xzz", "0x hex"],
    ["value", undefined, "a string"],
    ["value", "0", "a 0x hex quantity"],
    ["value", "0x", "a 0x hex quantity"],
    ["value", "0x00", "a 0x hex quantity"],
    ["value", "1000", "a 0x hex quantity"],
  ])(
    "refuses an evm_transaction whose %s is %s",
    async (field, value, must) => {
      await expect(answering({ ...SOUND_TX, [field]: value })).rejects.toThrow(
        `action.${field} must be ${must}`,
      );
    },
  );

  it("reads no action when the chain already shows the rule", async () => {
    expect(await answering(null, "swig")).toBeNull();
  });

  it.each([
    [{ kind: "user_op", network: "eip155:8453" }, /unsupported action/],
    [{ kind: "typed_data" }, /action.network must be a string/],
    [
      { kind: "typed_data", network: "eip155:8453" },
      /needs a domain, types and a message/,
    ],
    [
      {
        kind: "typed_data",
        network: "eip155:8453",
        typed_data: {
          domain: {},
          types: { Delegation: [{ name: "cap" }] },
          primaryType: "Delegation",
          message: {},
        },
      },
      /field type must be a string/,
    ],
  ])("refuses an unknown or malformed action %#", async (action, message) => {
    await expect(answering(action, "swig")).rejects.toThrow(message);
  });

  it("fills an entry's omitted fields", () => {
    const { rule, provider, name, network, state, ready } =
      body.enforcement[1]!;
    const bare = { rule, provider, name, network, state, ready };
    expect(
      parseWalletPolicies({
        ...body,
        enforcement: [{ ...bare, signer: { family: "evm" } }],
      }).enforcement,
    ).toEqual([
      { ...body.enforcement[1], signer: { family: "evm", address: null } },
    ]);
  });

  it.each([
    [{ state: "paused" }, /unsupported enforcement state/],
    [{ rule: undefined }, /enforcement.rule must be a string/],
    [{ left: 300000000 }, /enforcement.left must be a string/],
    [{ expires_at: "soon" }, /enforcement.expires_at must be a number/],
  ])("refuses an enforcement entry with %o", (extra, message) => {
    expect(() => parseWalletPolicies(enforcementEntry(extra))).toThrow(message);
  });

  it("reads the providers, defaulting a missing list and note", () => {
    expect(parseWalletPolicies(body).providers).toEqual(body.providers);
    const { providers: _omitted, ...older } = body;
    expect(parseWalletPolicies(older).providers).toEqual([]);
    const { note: _note, ...bare } = body.providers[1]!;
    expect(
      parseWalletPolicies({ ...body, providers: [bare] }).providers,
    ).toEqual([{ ...bare, note: null }]);
  });

  it.each([
    [{ holds: "everything" }, /unsupported provider holds/],
    [{ network: 8453 }, /providers.network must be a string/],
  ])("refuses a provider with %o", (extra, message) => {
    expect(() =>
      parseWalletPolicies({
        ...body,
        providers: [{ ...body.providers[0], ...extra }],
      }),
    ).toThrow(message);
  });

  it("keeps amounts beyond 2^53 as strings and an unknown token's null symbol", () => {
    const huge = "123456789012345678901234567890";
    const read = parseWalletPolicies({
      ...body,
      rules: withRule({ amount: huge, symbol: null }),
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
    ["a numeric amount", { rules: withRule({ amount: 5 }) }],
    ["an amount that is not digits", { rules: withRule({ amount: "1.5" }) }],
    [
      "a destination it does not know",
      { rules: withRule({ to: { kind: "contract" } }) },
    ],
    ["the first shape of the rules", { rules: { apps: null, limits: [] } }],
    [
      "a period that is not a number",
      { rules: withRule({ active_until: "2026-12-11" }) },
    ],
    ["a mode it does not know", { rules: { mode: "greylist" } }],
    ["a flag that is not a boolean", { rules: { linked_only: "yes" } }],
    ["an unknown admin", { admin: { kind: "multisig" } }],
  ])("rejects %s rather than dropping it from the next write", (_, extra) => {
    expect(() => parseWalletPolicies({ ...body, ...extra })).toThrow(
      /Invalid policy response/,
    );
  });

  it("reads no rules and tells them from a wallet with one", () => {
    const none = parseWalletPolicies({ ...body, rules: NO_RULES }).rules;
    expect(none).toEqual(NO_RULES);
    expect(hasPolicies(none)).toBe(false);
    expect(hasPolicies({ ...none, mode: "whitelist" })).toBe(true);
    expect(hasPolicies({ ...none, linked_only: true })).toBe(true);
  });

  it("changes rules with CSRF, sending a rule's asset, amount, destination and end, never its start", async () => {
    const { rules, calls } = backend({
      [`POST /v1/account/agent-wallets/${WALLET}/policy`]: () =>
        Response.json({
          status: "waiting",
          rules: { ...body, pending: change },
        }),
    });
    const read = parseWalletPolicies(body);
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

  it("revises from what it read, and reads once more when the rules moved under the write", async () => {
    let writes = 0;
    const { rules, calls } = backend({
      [`GET /v1/account/agent-wallets/${WALLET}/policy`]: () =>
        Response.json({ ...body, revision: 3 + writes }),
      [`POST /v1/account/agent-wallets/${WALLET}/policy`]: () =>
        (writes += 1) % 2
          ? Response.json({ error: "rules_changed" }, { status: 409 })
          : Response.json({ status: "applied", rules: body }),
    });
    const build = vi.fn((held: AomiWalletPolicies) => ({
      rules: { ...held.rules, linked_only: false },
    }));
    const result = await rules.revise(WALLET, build);
    expect(calls.map((call) => call.method)).toEqual([
      "GET",
      "POST",
      "GET",
      "POST",
    ]);
    expect(build.mock.calls.map(([held]) => held.revision)).toEqual([3, 4]);
    // Each write carries the revision it was built from.
    expect(
      calls
        .filter((call) => call.method === "POST")
        .map((call) => (call.body as { revision: number }).revision),
    ).toEqual([3, 4]);
    expect(result).toMatchObject({ status: "applied" });
    // Refused twice in a row: the caller hears it.
    writes = 0;
    const always = backend({
      [`GET /v1/account/agent-wallets/${WALLET}/policy`]: () =>
        Response.json(body),
      [`POST /v1/account/agent-wallets/${WALLET}/policy`]: () =>
        Response.json({ error: "rules_changed" }, { status: 409 }),
    });
    await expect(always.rules.revise(WALLET, build)).rejects.toMatchObject({
      code: POLICY_ERROR_CODES.changed,
    });
    expect(always.calls).toHaveLength(4);
  });

  it("says where each policy stands on chain", () => {
    const read = parseWalletPolicies(body);
    const entry = (state: string, ready: boolean, rule = SOL_RULE) => ({
      ...read.enforcement[0]!,
      rule,
      state: state as "on",
      ready,
    });
    const stands = (enforcement: ReturnType<typeof entry>[], id = SOL_RULE) =>
      policyOnChain({ ...read, enforcement }, id)?.kind;
    expect(stands([entry("on", false)])).toBe("in_sync");
    // On chain, with a revocation still to send: not in sync.
    for (const [next, kind] of [
      ["evm_transaction", "out_of_date"],
      ["typed_data", "out_of_date"],
      [null, "in_sync"],
    ] as const)
      expect(stands([{ ...entry("on", true), next }])).toBe(kind);
    expect(stands([entry("behind", true)])).toBe("out_of_date");
    expect(stands([entry("unverified", false)])).toBe("unverified");
    expect(stands([entry("off", true)])).toBe("not_deployed");
    // A provider that declines, or none at all: Aomi alone checks it.
    expect(stands([entry("off", false)])).toBe("aomi_only");
    expect(stands([])).toBe("aomi_only");
    // A removed policy: only what the chain still holds counts.
    const GONE = `${SOL}@any`;
    expect(stands([entry("on", true, GONE)], GONE)).toBe("chain_only");
    expect(stands([entry("off", false, GONE)], GONE)).toBeUndefined();
    expect(
      chainOnlyPolicies({ ...read, enforcement: [entry("on", true, GONE)] }),
    ).toEqual([GONE]);
    expect(chainOnlyPolicies(read)).toEqual([]);
    expect(policyOnChain(read, SOL_RULE, "metamask")?.kind).toBe("aomi_only");
    // Blacklist mode, no entry, and a provider on the policy's chain that
    // holds policies in whitelist mode only: the mode is the reason.
    const blacklist = {
      ...read,
      rules: { ...read.rules, mode: "blacklist" as const },
      enforcement: [],
      providers: [
        {
          provider: "swig",
          name: "Swig",
          network: "solana:mainnet-beta",
          holds: "total_period_and_destination" as const,
          note: null,
        },
      ],
    };
    expect(policyOnChain(blacklist, SOL_RULE)).toMatchObject({
      kind: "needs_whitelist",
      provider: { provider: "swig" },
    });
    // No provider on Base, another provider asked for, one this client does
    // not know, whitelist mode, or a provider that declined: Aomi only.
    expect(policyOnChain(blacklist, USDC_RULE)?.kind).toBe("aomi_only");
    expect(policyOnChain(blacklist, SOL_RULE, "metamask")?.kind).toBe(
      "aomi_only",
    );
    const [swig] = blacklist.providers;
    expect(
      policyOnChain(
        { ...blacklist, providers: [{ ...swig!, provider: "other" }] },
        SOL_RULE,
      )?.kind,
    ).toBe("aomi_only");
    expect(
      policyOnChain({ ...blacklist, rules: read.rules }, SOL_RULE)?.kind,
    ).toBe("aomi_only");
    expect(
      policyOnChain(
        { ...blacklist, enforcement: [entry("off", false)] },
        SOL_RULE,
      )?.kind,
    ).toBe("aomi_only");
    expect(expectedPolicyAction(read.enforcement[0]!)).toBe("transaction");
    expect(expectedPolicyAction(read.enforcement[1]!)).toBe("typed_data");
    expect(
      expectedPolicyAction(
        {
          ...read.enforcement[1]!,
          note: "Your revocation is signed. Send it to finish.",
        },
        { remove: true },
      ),
    ).toBe("evm_transaction");
    // An id, or a prefix of one or more ids, held by Aomi or only on chain.
    const both = { ...read, enforcement: [entry("on", true, GONE)] };
    expect(matchPolicyIds(both, SOL_RULE)).toEqual([SOL_RULE]);
    expect(matchPolicyIds(both, `${SOL}@a`)).toEqual([GONE]);
    expect(matchPolicyIds(both, `${SOL}@`)).toEqual([SOL_RULE, GONE]);
    expect(matchPolicyIds(both, "nope")).toEqual([]);
    // The backend's `next` wins over the inference; null is no wallet action.
    const evm = read.enforcement[1]!;
    expect(expectedPolicyAction({ ...evm, next: "evm_transaction" })).toBe(
      "evm_transaction",
    );
    expect(
      expectedPolicyAction({ ...evm, next: null }, { remove: true }),
    ).toBeNull();
    // `next` is about holding a policy still in force, not removing it.
    expect(
      expectedPolicyAction(
        { ...evm, next: null },
        { remove: true, inForce: true },
      ),
    ).toBe("typed_data");
    const next = (value: unknown) =>
      parseWalletPolicies({
        ...body,
        enforcement: [{ ...body.enforcement[0], next: value }],
      }).enforcement[0]!.next;
    expect(read.enforcement[0]).not.toHaveProperty("next");
    expect([next(null), next("transaction")]).toEqual([null, "transaction"]);
    expect(() => next("sign_message")).toThrow(/unsupported enforcement next/);
  });

  it("changes the admin or Instant connections without touching the rules", async () => {
    const { rules, calls } = backend({
      [`POST /v1/account/agent-wallets/${WALLET}/policy`]: () =>
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
      "GET /v1/account/policy/catalog": () => Response.json(catalog),
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
      [`GET /v1/account/policy-changes/${CHANGE}`]: () => Response.json(signed),
    });
    expect(await rules.getChange(CHANGE)).toEqual(signed);
    expect(() => parsePolicyChange({ ...change, state: "paused" })).toThrow(
      /unsupported change state/,
    );
  });

  it("approves with an empty body or a signature, and declines", async () => {
    const { rules, calls } = backend({
      [`POST /v1/account/policy-changes/${CHANGE}/approve`]: () =>
        Response.json(body),
      [`POST /v1/account/policy-changes/${CHANGE}/decline`]: () =>
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
    [403, POLICY_ERROR_CODES.loginStale],
    [403, POLICY_ERROR_CODES.signatureRequired],
    [409, POLICY_ERROR_CODES.changeNotOpen],
    [409, POLICY_ERROR_CODES.changed],
    [400, POLICY_ERROR_CODES.periodInvalid],
    [404, POLICY_ERROR_CODES.changeNotFound],
  ])("raises %i %s as a typed error", async (status, code) => {
    const { rules } = backend({
      [`POST /v1/account/policy-changes/${CHANGE}/approve`]: () =>
        Response.json({ error: code }, { status }),
    });
    const error = await rules.approveChange(CHANGE).catch((caught) => caught);
    expect(error).toBeInstanceOf(AomiWalletError);
    expect(error).toMatchObject({ status, code });
  });
});
