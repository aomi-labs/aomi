import { describe, expect, it } from "vitest";
import type { AomiPolicyEnforcement } from "@aomi-labs/client";
import {
  activePolicyCount,
  dayFromToday,
  draftPolicies,
  endOfLocalDay,
  localDay,
  periodLine,
  policyAmount,
  policyCatalog,
  policyProviders,
  NEEDS_WHITELIST,
  policyRows,
  policyToPhrase,
  removalSummary,
  removedPolicies,
  policyEnforcement,
} from "./policy-model";

const BASE_USDC =
  "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const OP_USDC = "eip155:10/erc20:0x0b2c639c533813f4aa9d7837caf62653d097ff85";
const SOL = "solana:mainnet-beta/native";
const OWNER = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const NOW = new Date(2026, 10, 18, 12).getTime();
const at = (year: number, month: number, day: number, hour = 9) =>
  Math.floor(new Date(year, month - 1, day, hour).getTime() / 1000);
const DEC_11 = at(2026, 12, 11, 23);
const NOV_17 = at(2026, 11, 17, 23);

const rule = (asset: string, extra: object = {}) => ({
  id: `${asset}@any`,
  asset,
  amount: "1000000000",
  to: { kind: "any_protocol" as const },
  active_from: at(2026, 11, 11),
  symbol: asset === SOL ? "SOL" : "USDC",
  decimals: asset === SOL ? 9 : 6,
  ...extra,
});
const SWIG_TX =
  "99eUso3aSbE9tqGSTXzo3TLfKb9RkMTURrHKQ1K7Zh3BbeqPevr5E1iCbpTjqHuTFLtfxTTD5ekfVuZFzQyEQf8";
const SWIG_WALLET = "cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN";
const EVM_TX = `0x${"ab".repeat(32)}`;
const VAULT = "0x00000000000000000000000000000000000000a1";
/** One provider's entry for one rule: Swig on Solana, off. */
const provider = (extra: Partial<AomiPolicyEnforcement> = {}) =>
  ({
    rule: `${SOL}@any`,
    provider: "swig",
    name: "Swig",
    network: "solana:mainnet-beta",
    state: "off",
    ready: false,
    left: null,
    expires_at: null,
    account: null,
    deployment_tx: null,
    note: null,
    signer: { family: "svm", address: null },
    ...extra,
  }) as AomiPolicyEnforcement;
const metamask = (asset: string, extra: Partial<AomiPolicyEnforcement> = {}) =>
  provider({
    rule: `${asset}@any`,
    provider: "metamask",
    name: "MetaMask",
    network: asset.split("/")[0]!,
    signer: { family: "evm", address: null },
    ...extra,
  });
const wallet = (
  rules: object[],
  enforcement: AomiPolicyEnforcement[] = [],
) => ({
  rules: { mode: "whitelist" as const, rules, linked_only: false } as never,
  enforcement,
});
const rows = (rules: object[], entries: AomiPolicyEnforcement[] = []) =>
  policyRows(wallet(rules, entries), null, NOW);

describe("policy rows", () => {
  it("merges rules that differ only by chain into one row, and keeps the rest apart", () => {
    const result = rows([
      rule(BASE_USDC),
      rule(OP_USDC),
      rule(BASE_USDC, {
        id: `${BASE_USDC}@protocol:uniswap`,
        to: { kind: "protocol", id: "uniswap" },
      }),
      rule(OP_USDC, {
        id: `${OP_USDC}@protocol:aave`,
        to: { kind: "protocol", id: "aave" },
        active_until: DEC_11,
      }),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      policyIds: [`${BASE_USDC}@any`, `${OP_USDC}@any`],
      symbol: "USDC",
      amount: "1,000",
      chains: [
        { label: "Base", network: "eip155:8453" },
        { label: "Optimism", network: "eip155:10" },
      ],
      activeFrom: "2026-11-11",
      activeUntil: null,
      ended: false,
    });
    expect(periodLine(result[0]!)).toBe(
      "Active period: Always on, since 11/11/2026",
    );
    expect(periodLine(result[2]!)).toBe(
      "Active period: 11/11/2026 – 11/12/2026",
    );
  });

  it("says why nothing holds a policy on chain in blacklist mode, where a provider serves its chain", () => {
    const held = {
      ...wallet([rule(SOL), rule(BASE_USDC)]),
      rules: {
        mode: "blacklist",
        rules: [rule(SOL), rule(BASE_USDC)],
        linked_only: false,
      } as never,
      providers: [
        {
          provider: "swig",
          name: "Swig",
          network: SOL.split("/")[0]!,
          holds: "total_period_and_destination" as const,
          note: null,
        },
      ],
    };
    const [sol, usdc] = policyRows(held, null, NOW);
    expect(sol!.enforcement).toEqual({ name: null, note: NEEDS_WHITELIST });
    expect(usdc!.enforcement).toEqual({ name: null });
  });

  it("keeps an ended rule, says when it ended, and does not count it", () => {
    const rules = wallet([
      rule(BASE_USDC, { active_until: NOV_17 }),
      rule(SOL),
    ]);
    const [ended, open] = policyRows(rules, null, NOW);
    expect(ended).toMatchObject({ ended: true, activeUntil: "2026-11-17" });
    expect(periodLine(ended!)).toBe("Ended 17/11/2026");
    expect(open!.ended).toBe(false);
    expect(activePolicyCount(rules, NOW)).toBe(1);
  });

  it("shows a token it cannot name in raw units, and a zero total as a block", () => {
    const [row] = rows([
      rule(BASE_USDC, { amount: "0", symbol: null, decimals: null }),
    ]);
    expect(row).toMatchObject({
      amount: "0",
      blocked: true,
      symbol: "0x8335…2913",
    });
  });

  it("groups thousands by string, past 2^53", () => {
    expect(policyAmount("12345678901234567890.5")).toBe(
      "12,345,678,901,234,567,890.5",
    );
    expect(policyAmount("999")).toBe("999");
  });
});

describe("a rule's on-chain enforcement", () => {
  const sol = rule(SOL);
  const base = rule(BASE_USDC);
  const on = provider({ state: "on" });
  const held = metamask(BASE_USDC, { state: "on", account: VAULT });
  const DEPLOY = `swig:solana:mainnet-beta:${SOL}@any`;
  const NOTE = "Swig cannot hold a rule that allows nothing.";

  const behind = { name: "Swig", href: undefined, deploy: DEPLOY };
  const unread = "The chain could not be read.";
  it.each([
    [[], { name: null }],
    // Another rule's entry says nothing about this one.
    [
      [provider({ rule: `${SOL}@protocol:jupiter`, state: "on" })],
      { name: null },
    ],
    [[provider()], { name: null }],
    [[provider({ note: NOTE })], { name: null, note: NOTE }],
    [[on], { name: "Swig", href: undefined }],
    [[provider({ ready: true })], { name: "Swig", deploy: DEPLOY }],
    [
      [provider({ state: "behind", ready: true, note: "Changed." })],
      { ...behind, warning: { label: "Out of date" }, note: "Changed." },
    ],
    [
      [provider({ state: "unverified", note: unread })],
      {
        name: "Swig",
        href: undefined,
        warning: { label: "Not verified" },
        note: unread,
      },
    ],
  ] as const)("reads entries %#", (entries, expected) => {
    expect(policyEnforcement(sol, entries as never)).toEqual(expected);
  });

  const SOLSCAN = "https://solscan.io";
  const BASESCAN = `https://basescan.org/address/${VAULT}`;
  it.each([
    [
      sol,
      { ...on, signer: { family: "svm", address: OWNER } },
      `${SOLSCAN}/account/${OWNER}`,
    ],
    [sol, { ...on, account: SWIG_WALLET }, `${SOLSCAN}/account/${SWIG_WALLET}`],
    [
      sol,
      { ...on, account: SWIG_WALLET, deployment_tx: SWIG_TX },
      `${SOLSCAN}/tx/${SWIG_TX}`,
    ],
    // Nothing on chain yet: no link.
    [
      sol,
      provider({ ready: true, account: SWIG_WALLET, deployment_tx: SWIG_TX }),
      undefined,
    ],
    [base, held, BASESCAN],
    // A signature is not a transaction hash.
    [base, { ...held, deployment_tx: `0x${"cd".repeat(65)}` }, BASESCAN],
    [
      base,
      { ...held, deployment_tx: EVM_TX },
      `https://basescan.org/tx/${EVM_TX}`,
    ],
  ] as const)(
    "links the deployment, else the account %#",
    (target, entry, href) => {
      expect(policyEnforcement(target, [entry as never]).href).toBe(href);
    },
  );

  it("says what is left of the total, in the token's own units, when the chain reports it", () => {
    const SOL_UNITS = { symbol: "SOL", decimals: 9 };
    const left = (entry: AomiPolicyEnforcement, units?: typeof SOL_UNITS) =>
      policyEnforcement(sol, [entry], units).left;
    expect(left(provider({ state: "on", left: "400000000" }), SOL_UNITS)).toBe(
      "0.4 SOL left",
    );
    expect(left(provider({ state: "on", left: "400000000" }))).toBe(
      "400000000 solana:mainnet-beta/native left",
    );
    expect(left(provider({ state: "on", left: "0" }), SOL_UNITS)).toBe(
      "0 SOL left",
    );
    // Nothing on chain, nothing left.
    expect(
      left(provider({ left: "5", ready: true }), SOL_UNITS),
    ).toBeUndefined();
  });

  it("shows the chain's end only when it is more than a day from the policy's own", () => {
    const ends = rule(SOL, { active_until: DEC_11 });
    const chainEnd = (expires_at: number) =>
      policyEnforcement(ends, [provider({ state: "on", expires_at })]).chainEnd;
    expect(chainEnd(DEC_11 + 14 * 3600)).toBeUndefined();
    expect(chainEnd(DEC_11 - 3600)).toBeUndefined();
    expect(chainEnd(DEC_11 + 2 * 86_400)).toBe(localDay(DEC_11 + 2 * 86_400));
    // A rule with no end of its own that the chain ends.
    expect(
      policyEnforcement(sol, [provider({ state: "on", expires_at: DEC_11 })])
        .chainEnd,
    ).toBe("2026-12-11");
  });
});

describe("per-rule enforcement rows", () => {
  it("gives each rule its own state, even on the same chain", () => {
    const jupiter = rule(SOL, {
      id: `${SOL}@protocol:jupiter`,
      to: { kind: "protocol", id: "jupiter" },
    });
    expect(
      rows(
        [rule(SOL), jupiter],
        [
          provider({ state: "on", left: "100000000", account: SWIG_WALLET }),
          provider({ rule: jupiter.id, ready: true }),
        ],
      ).map((row) => row.enforcement),
    ).toEqual([
      {
        name: "Swig",
        href: `https://solscan.io/account/${SWIG_WALLET}`,
        left: "0.1 SOL left",
      },
      { name: "Swig", deploy: `swig:solana:mainnet-beta:${jupiter.id}` },
    ]);
  });

  const both = (extra: Partial<AomiPolicyEnforcement>) => [
    metamask(BASE_USDC, extra),
    metamask(OP_USDC, extra),
  ];
  // One row only while everything shown about the chains is the same.
  it.each([
    [[], 1],
    [both({ note: "No grant for a zero total." }), 1],
    [[metamask(BASE_USDC, { state: "on", account: VAULT })], 2],
    // Held on both, but each links its own explorer.
    [both({ state: "on", account: VAULT }), 2],
    [
      [
        metamask(BASE_USDC, { state: "behind" }),
        metamask(OP_USDC, { state: "unverified" }),
      ],
      2,
    ],
    // Each waits for its own signature.
    [both({ ready: true }), 2],
  ])("merges chains only when alike %#", (entries, count) => {
    expect(rows([rule(BASE_USDC), rule(OP_USDC)], entries)).toHaveLength(count);
  });

  it("says a rule waiting for its deployment starts when you sign", () => {
    const waiting = (extra: object) =>
      rows(
        [rule(SOL, { active_from: undefined, ...extra })],
        [provider({ ready: true })],
      )[0]!;
    expect(waiting({}).activeFrom).toBeNull();
    expect(periodLine(waiting({}))).toBe(
      "Active period: always on, starts when you sign",
    );
    expect(periodLine(waiting({ active_until: DEC_11 }))).toBe(
      "Active period: starts when you sign, through 11/12/2026",
    );
  });

  it("offers nothing to sign for a policy that ended", () => {
    const [ended] = rows(
      [rule(SOL, { active_until: NOV_17 })],
      [provider({ state: "behind", ready: true })],
    );
    expect(ended!.enforcement).toEqual({ name: null });
  });
});

describe("removed policies the chain still holds", () => {
  const catalog = {
    apps: [{ id: "aave", label: "Aave", chains: ["eip155:8453"] }],
    tokens: [
      { asset: BASE_USDC, symbol: "USDC", decimals: 6, chain: "Base" },
      { asset: SOL, symbol: "SOL", decimals: 9, chain: "Solana" },
    ],
  } as never;
  const REMOVED = `${BASE_USDC}@protocol:aave`;
  const NOTE =
    "This rule was removed or has ended. Sign to take off what the chain holds for it.";
  /** What the backend keeps under the old id: behind, ready, with a total left. */
  const held = (extra: Partial<AomiPolicyEnforcement> = {}) =>
    metamask(BASE_USDC, {
      rule: REMOVED,
      state: "behind",
      ready: true,
      left: "5000000",
      expires_at: at(2026, 12, 31),
      account: VAULT,
      note: NOTE,
      signer: { family: "evm", address: OWNER },
      ...extra,
    });
  const removed = (entries: AomiPolicyEnforcement[], rules: object[] = []) =>
    removedPolicies(wallet(rules, entries), catalog);

  it("makes a row of an entry whose rule is gone, from what its id and the catalog say", () => {
    const [row, ...rest] = removed([held()]);
    expect(rest).toEqual([]);
    expect(row).toEqual({
      key: `metamask:eip155:8453:${REMOVED}`,
      id: REMOVED,
      symbol: "USDC",
      to: { kind: "app", id: "aave", label: "Aave" },
      chain: { label: "Base", network: "eip155:8453" },
      enforcement: {
        name: "MetaMask",
        href: `https://basescan.org/address/${VAULT}`,
        deploy: `metamask:eip155:8453:${REMOVED}`,
        note: NOTE,
        left: "5 USDC left",
      },
    });
    expect(policyToPhrase(row!.to!)).toBe("on Aave");
    expect(removalSummary(row!)).toBe("Take USDC on Aave (Base) off the chain");
  });

  it("marks the step as a send once the owner's revocation is signed, and only then", () => {
    const SENT = "Your revocation is signed. Send it from your wallet.";
    const send = (extra: Partial<AomiPolicyEnforcement>) =>
      removed([held(extra)])[0]!.enforcement.send;
    expect(send({ note: SENT })).toBe(true);
    // Not ready, still to sign, or the relay's older wording.
    for (const extra of [
      { note: SENT, ready: false },
      { note: NOTE },
      { note: null },
      { note: "Your revocation is signed. It takes effect once it is sent." },
    ])
      expect(send(extra)).toBeUndefined();
  });

  it("reads a destination of any app, or an address, and the Solana chain", () => {
    const [any, address] = removed([
      provider({ state: "behind", ready: true }),
      provider({
        rule: `${SOL}@address:${SWIG_WALLET}`,
        state: "behind",
        ready: true,
        left: "2500000000",
      }),
    ]);
    expect(any).toMatchObject({
      symbol: "SOL",
      to: { kind: "any_app" },
      chain: { label: "Solana", network: "solana:mainnet-beta" },
    });
    expect(address).toMatchObject({
      to: { kind: "address", address: SWIG_WALLET },
    });
    expect(address!.enforcement.left).toBe("2.5 SOL left");
    expect(policyToPhrase(address!.to!)).toBe("to cGfHiC…izuN");
  });

  it("shows what it cannot name as the id writes it: the raw asset, the app id, units", () => {
    const [row] = removed([
      held({ rule: `${OP_USDC}@protocol:velodrome`, network: "eip155:10" }),
    ]);
    expect(row).toMatchObject({
      symbol: "0x0b2c…ff85",
      to: { kind: "app", id: "velodrome", label: "Velodrome" },
      chain: { label: "Optimism" },
    });
    expect(row!.enforcement.left).toBe("5000000 0x0b2c…ff85 left");
    expect(removedPolicies(wallet([], [held()]))[0]).toMatchObject({
      symbol: "0x8335…2913",
      to: { label: "Aave" },
    });
  });

  it("ignores an entry that is off, and an entry for a rule that is still current", () => {
    expect(
      removed(
        [
          held({ state: "off", ready: false, left: null }),
          held({ rule: `${SOL}@any`, state: "off", ready: true, left: null }),
          held(),
        ],
        [rule(BASE_USDC, { id: REMOVED })],
      ),
    ).toEqual([]);
  });

  it("gives every entry its own row, offers the step only where it is ready, and warns where the chain could not be read", () => {
    const other = `${BASE_USDC}@any`;
    const result = removed([
      held(),
      held({ rule: other }),
      held({ rule: `${SOL}@any`, ready: false, state: "unverified" }),
    ]);
    expect(result.map((row) => row.id)).toEqual([REMOVED, other, `${SOL}@any`]);
    expect(result.map((row) => row.enforcement.deploy !== undefined)).toEqual([
      true,
      true,
      false,
    ]);
    expect(result[2]!.enforcement.warning).toEqual({ label: "Not verified" });
  });

  it("is no live policy: the rows and the count are the rules' alone", () => {
    const rules = wallet([rule(SOL)], [held()]);
    expect(policyRows(rules, catalog, NOW)).toHaveLength(1);
    expect(activePolicyCount(rules, NOW)).toBe(1);
    expect(removedPolicies(rules, catalog)).toHaveLength(1);
  });
});

describe("the picker's providers", () => {
  const listed = (provider: string, name: string, network: string) => ({
    provider,
    name,
    network,
    holds: "total_and_period" as const,
    note: null,
  });
  it("reads each network's provider from the backend's list, rule or not", () => {
    expect(
      policyProviders({
        providers: [
          {
            ...listed("swig", "Swig", "solana:mainnet-beta"),
            holds: "total_period_and_destination",
          },
          listed("metamask", "MetaMask", "eip155:1"),
        ],
        enforcement: [],
      }),
    ).toEqual({
      "solana:mainnet-beta": {
        name: "Swig",
        holds: "total_period_and_destination",
      },
      "eip155:1": { name: "MetaMask", holds: "total_and_period" },
    });
  });

  it("falls back to the wallet's own entries from a backend that lists none", () => {
    expect(
      policyProviders({ providers: [], enforcement: [provider()] }),
    ).toEqual({ "solana:mainnet-beta": { name: "Swig" } });
    expect(policyProviders({ providers: [], enforcement: [] })).toEqual({});
  });
});

describe("the picker's catalog and draft", () => {
  const catalog = policyCatalog({
    apps: [{ id: "uniswap", label: "Uniswap", chains: ["eip155:8453"] }],
    tokens: [
      { asset: BASE_USDC, symbol: "USDC", decimals: 6, chain: "Base" },
      { asset: OP_USDC, symbol: "USDC", decimals: 6, chain: "OP" },
      { asset: SOL, symbol: "SOL", decimals: 9, chain: "Solana" },
    ],
  });
  const [usdc, sol] = catalog.tokens;

  it("lists one token with its chains and each contract's explorer page", () => {
    expect(catalog.tokens.map((token) => token.symbol)).toEqual([
      "USDC",
      "SOL",
    ]);
    expect(usdc!.chains[0]).toEqual({
      chain: { label: "Base", network: "eip155:8453" },
      asset: BASE_USDC,
      decimals: 6,
      address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      explorer:
        "https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    });
    expect(sol!.chains[0]).not.toHaveProperty("address");
  });

  it("makes one rule per chain, ending at the end of the chosen local day", () => {
    const end = endOfLocalDay("2026-12-11");
    expect(new Date(end * 1000).getHours()).toBe(23);
    expect(new Date(end * 1000).getMinutes()).toBe(59);
    expect(localDay(end)).toBe("2026-12-11");
    expect(localDay(end + 1)).toBe("2026-12-12");
    const to = { kind: "protocol", id: "uniswap" };
    expect(
      draftPolicies({
        symbol: "USDC",
        amount: "12.5",
        chains: usdc!.chains,
        to: { kind: "app", id: "uniswap", label: "Uniswap" },
        activeUntil: "2026-12-11",
      }),
    ).toEqual([
      { asset: BASE_USDC, amount: "12500000", to, active_until: end },
      { asset: OP_USDC, amount: "12500000", to, active_until: end },
    ]);
  });

  it("sends no end for always on, and refuses more digits than the token holds", () => {
    const draft = (symbol: string, amount: string, chains = usdc!.chains) =>
      draftPolicies({
        symbol,
        amount,
        chains,
        to: { kind: "any_app" },
        activeUntil: null,
      });
    expect(draft("SOL", "1", sol!.chains)).toEqual([
      { asset: SOL, amount: "1000000000", to: { kind: "any_protocol" } },
    ]);
    expect(draft("USDC", "0.0000001")).toBeNull();
  });

  it("counts days on the local calendar", () => {
    expect(dayFromToday(1, new Date(2026, 11, 31, 23, 30))).toBe("2027-01-01");
    expect(dayFromToday(0, new Date(2026, 10, 18, 0, 5))).toBe("2026-11-18");
  });
});
