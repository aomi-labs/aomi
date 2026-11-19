import { describe, expect, it } from "vitest";
import type { AomiRulesEnforcement } from "@aomi-labs/client";
import {
  activePolicyCount,
  dayFromToday,
  draftRules,
  endOfLocalDay,
  localDay,
  periodLine,
  policyAmount,
  policyCatalog,
  policyProviders,
  policyRows,
  policyToPhrase,
  removalSummary,
  removedPolicies,
  ruleEnforcement,
} from "./policy-model";

const BASE_USDC =
  "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const OP_USDC = "eip155:10/erc20:0x0b2c639c533813f4aa9d7837caf62653d097ff85";
const SOL = "solana:mainnet-beta/native";
const OWNER = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const NOW = new Date(2026, 10, 18, 12).getTime();
const at = (year: number, month: number, day: number, hour = 9) =>
  Math.floor(new Date(year, month - 1, day, hour).getTime() / 1000);

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
/** One provider's entry for one rule; it defaults to Swig on Solana, off. */
const provider = (extra: Partial<AomiRulesEnforcement> = {}) =>
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
  }) as AomiRulesEnforcement;
/** MetaMask holding one EVM rule by a signed grant: no transaction. */
const metamask = (asset: string, extra: Partial<AomiRulesEnforcement> = {}) =>
  provider({
    rule: `${asset}@any`,
    provider: "metamask",
    name: "MetaMask",
    network: asset.split("/")[0]!,
    signer: { family: "evm", address: null },
    ...extra,
  });
const wallet = (rules: object[], enforcement: AomiRulesEnforcement[] = []) => ({
  rules: { mode: "whitelist" as const, rules, linked_only: false } as never,
  enforcement,
});

describe("policy rows", () => {
  it("merges rules that differ only by chain into one row, and keeps the rest apart", () => {
    const rows = policyRows(
      wallet([
        rule(BASE_USDC),
        rule(OP_USDC),
        // Another total: its own row.
        rule(BASE_USDC, {
          id: `${BASE_USDC}@protocol:uniswap`,
          to: { kind: "protocol", id: "uniswap" },
        }),
        // Another period: its own row.
        rule(OP_USDC, {
          id: `${OP_USDC}@protocol:aave`,
          to: { kind: "protocol", id: "aave" },
          active_until: at(2026, 12, 11, 23),
        }),
      ]),
      null,
      NOW,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      ruleIds: [`${BASE_USDC}@any`, `${OP_USDC}@any`],
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
    expect(periodLine(rows[0]!)).toBe(
      "Active period: Always on, since 11/11/2026",
    );
    expect(periodLine(rows[2]!)).toBe("Active period: 11/11/2026 – 11/12/2026");
  });

  it("keeps an ended rule, says when it ended, and does not count it", () => {
    const rules = wallet([
      rule(BASE_USDC, { active_until: at(2026, 11, 17, 23) }),
      rule(SOL),
    ]);
    const [ended, open] = policyRows(rules, null, NOW);
    expect(ended).toMatchObject({ ended: true, activeUntil: "2026-11-17" });
    expect(periodLine(ended!)).toBe("Ended 17/11/2026");
    expect(open!.ended).toBe(false);
    expect(activePolicyCount(rules, NOW)).toBe(1);
  });

  it("shows a token it cannot name in raw units, and a zero total as a block", () => {
    const [row] = policyRows(
      wallet([rule(BASE_USDC, { amount: "0", symbol: null, decimals: null })]),
      null,
      NOW,
    );
    expect(row).toMatchObject({ amount: "0", blocked: true });
    expect(row!.symbol).toBe("0x8335…2913");
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
  it("is None where no provider has an entry for this very rule", () => {
    expect(ruleEnforcement(sol, [])).toEqual({ name: null });
    // Another rule's entry says nothing about this one, nor does the chain's.
    expect(
      ruleEnforcement(sol, [
        provider({ rule: `${SOL}@protocol:jupiter`, state: "on", ready: true }),
      ]),
    ).toEqual({ name: null });
  });

  it("is None, with the reason, where the provider declines the rule", () => {
    expect(ruleEnforcement(sol, [provider()])).toEqual({ name: null });
    expect(
      ruleEnforcement(sol, [
        provider({ note: "Swig cannot hold a rule that allows nothing." }),
      ]),
    ).toEqual({
      name: null,
      note: "Swig cannot hold a rule that allows nothing.",
    });
  });

  it("names the provider that holds it and links the deployment, else the account", () => {
    const on = provider({ state: "on" });
    // On, but the chain gave no account and the wallet no transaction.
    expect(ruleEnforcement(sol, [on])).toEqual({
      name: "Swig",
      href: undefined,
    });
    // The owner's wallet is the account to see until there is a transaction.
    expect(
      ruleEnforcement(sol, [
        { ...on, signer: { family: "svm", address: OWNER } },
      ]).href,
    ).toBe(`https://solscan.io/account/${OWNER}`);
    expect(ruleEnforcement(sol, [{ ...on, account: SWIG_WALLET }]).href).toBe(
      `https://solscan.io/account/${SWIG_WALLET}`,
    );
    expect(
      ruleEnforcement(sol, [
        { ...on, account: SWIG_WALLET, deployment_tx: SWIG_TX },
      ]).href,
    ).toBe(`https://solscan.io/tx/${SWIG_TX}`);
  });

  it("links an EVM grant to the owner's account: nothing was deployed, so no transaction", () => {
    const base = rule(BASE_USDC);
    const held = metamask(BASE_USDC, { state: "on", account: VAULT });
    expect(ruleEnforcement(base, [held])).toEqual({
      name: "MetaMask",
      href: `https://basescan.org/address/${VAULT}`,
    });
    // A signature is not a transaction hash: the account is still the link.
    expect(
      ruleEnforcement(base, [
        { ...held, deployment_tx: `0x${"cd".repeat(65)}` },
      ]).href,
    ).toBe(`https://basescan.org/address/${VAULT}`);
    expect(
      ruleEnforcement(base, [{ ...held, deployment_tx: EVM_TX }]).href,
    ).toBe(`https://basescan.org/tx/${EVM_TX}`);
  });

  it("has no link until something is on chain", () => {
    expect(
      ruleEnforcement(sol, [
        provider({ ready: true, account: SWIG_WALLET, deployment_tx: SWIG_TX }),
      ]).href,
    ).toBeUndefined();
  });

  it("offers to sign where the entry is ready, with its own step", () => {
    expect(ruleEnforcement(sol, [provider({ ready: true })])).toEqual({
      name: "Swig",
      deploy: `swig:solana:mainnet-beta:${SOL}@any`,
    });
    expect(
      ruleEnforcement(sol, [
        provider({ state: "behind", ready: true, note: "Your rules changed." }),
      ]),
    ).toEqual({
      name: "Swig",
      href: undefined,
      deploy: `swig:solana:mainnet-beta:${SOL}@any`,
      warning: { label: "Out of date" },
      note: "Your rules changed.",
    });
  });

  it("warns, without a step, where the chain could not be read", () => {
    expect(
      ruleEnforcement(sol, [
        provider({ state: "unverified", note: "The chain could not be read." }),
      ]),
    ).toEqual({
      name: "Swig",
      href: undefined,
      warning: { label: "Not verified" },
      note: "The chain could not be read.",
    });
  });

  it("says what is left of the total, in the token's own units, when the chain reports it", () => {
    const on = provider({ state: "on", left: "400000000" });
    expect(
      ruleEnforcement(sol, [on], { symbol: "SOL", decimals: 9 }).left,
    ).toBe("0.4 SOL left");
    expect(
      ruleEnforcement(
        rule(BASE_USDC),
        [metamask(BASE_USDC, { state: "on", left: "1234500000" })],
        { symbol: "USDC", decimals: 6 },
      ).left,
    ).toBe("1,234.5 USDC left");
    // A token it cannot name is shown in raw units, like the total.
    expect(ruleEnforcement(sol, [on]).left).toBe(
      "400000000 solana:mainnet-beta/native left",
    );
    // Nothing on chain, nothing left.
    expect(
      ruleEnforcement(sol, [provider({ left: "5", ready: true })], {
        symbol: "SOL",
        decimals: 9,
      }).left,
    ).toBeUndefined();
    expect(
      ruleEnforcement(sol, [provider({ state: "on", left: "0" })], {
        symbol: "SOL",
        decimals: 9,
      }).left,
    ).toBe("0 SOL left");
  });

  it("shows the chain's end only when it is more than a day from the policy's own", () => {
    const end = at(2026, 12, 11, 23);
    const ends = rule(SOL, { active_until: end });
    const on = (expires_at: number) =>
      ruleEnforcement(ends, [provider({ state: "on", expires_at })]);
    // The few hours of slack the chain adds are not news.
    expect(on(end + 14 * 3600).chainEnd).toBeUndefined();
    expect(on(end - 3600).chainEnd).toBeUndefined();
    expect(on(end + 2 * 86_400).chainEnd).toBe(localDay(end + 2 * 86_400));
    // A rule with no end of its own that the chain ends is worth saying.
    expect(
      ruleEnforcement(sol, [provider({ state: "on", expires_at: end })])
        .chainEnd,
    ).toBe("2026-12-11");
  });
});

describe("per-rule enforcement rows", () => {
  const sol = rule(SOL);
  const jupiter = rule(SOL, {
    id: `${SOL}@protocol:jupiter`,
    to: { kind: "protocol", id: "jupiter" },
  });
  const enforcements = (rules: object[], entries: AomiRulesEnforcement[]) =>
    policyRows(wallet(rules, entries), null, NOW).map((row) => row.enforcement);

  it("gives each rule its own state, even on the same chain", () => {
    expect(
      enforcements(
        [sol, jupiter],
        [
          provider({ state: "on", left: "100000000", account: SWIG_WALLET }),
          provider({ rule: jupiter.id, ready: true }),
        ],
      ),
    ).toEqual([
      {
        name: "Swig",
        href: `https://solscan.io/account/${SWIG_WALLET}`,
        left: "0.1 SOL left",
      },
      { name: "Swig", deploy: `swig:solana:mainnet-beta:${jupiter.id}` },
    ]);
  });

  it("merges rules across chains only while everything shown about them is the same", () => {
    // Neither chain has an entry: one row, as before.
    expect(
      policyRows(wallet([rule(BASE_USDC), rule(OP_USDC)]), null, NOW),
    ).toHaveLength(1);
    // Both declined for the same reason: still one row.
    const declined = (asset: string) =>
      metamask(asset, { note: "No grant for a zero total." });
    expect(
      policyRows(
        wallet(
          [rule(BASE_USDC), rule(OP_USDC)],
          [declined(BASE_USDC), declined(OP_USDC)],
        ),
        null,
        NOW,
      ),
    ).toHaveLength(1);
    // One chain held, the other not: two rows.
    expect(
      policyRows(
        wallet(
          [rule(BASE_USDC), rule(OP_USDC)],
          [metamask(BASE_USDC, { state: "on", account: VAULT })],
        ),
        null,
        NOW,
      ),
    ).toHaveLength(2);
    // Held on both, but each chain links to its own explorer: a row each.
    expect(
      policyRows(
        wallet(
          [rule(BASE_USDC), rule(OP_USDC)],
          [
            metamask(BASE_USDC, { state: "on", account: VAULT }),
            metamask(OP_USDC, { state: "on", account: VAULT }),
          ],
        ),
        null,
        NOW,
      ),
    ).toHaveLength(2);
    // Out of date on one chain, held on the other: two rows.
    expect(
      policyRows(
        wallet(
          [rule(BASE_USDC), rule(OP_USDC)],
          [
            metamask(BASE_USDC, { state: "behind" }),
            metamask(OP_USDC, { state: "unverified" }),
          ],
        ),
        null,
        NOW,
      ),
    ).toHaveLength(2);
  });

  it("keeps one row per chain where each is waiting for its own signature", () => {
    const rows = policyRows(
      wallet(
        [rule(BASE_USDC), rule(OP_USDC)],
        [
          metamask(BASE_USDC, { ready: true }),
          metamask(OP_USDC, { ready: true }),
        ],
      ),
      null,
      NOW,
    );
    expect(rows.map((row) => row.enforcement.deploy)).toEqual([
      `metamask:eip155:8453:${BASE_USDC}@any`,
      `metamask:eip155:10:${OP_USDC}@any`,
    ]);
  });

  it("says a rule waiting for its deployment starts when you sign", () => {
    const [waiting] = policyRows(
      wallet(
        [rule(SOL, { active_from: undefined })],
        [provider({ ready: true })],
      ),
      null,
      NOW,
    );
    expect(waiting!.activeFrom).toBeNull();
    expect(periodLine(waiting!)).toBe(
      "Active period: always on, starts when you sign",
    );
    const [ends] = policyRows(
      wallet(
        [
          rule(SOL, {
            active_from: undefined,
            active_until: at(2026, 12, 11, 23),
          }),
        ],
        [provider({ ready: true })],
      ),
      null,
      NOW,
    );
    expect(periodLine(ends!)).toBe(
      "Active period: starts when you sign, through 11/12/2026",
    );
  });

  it("offers nothing to sign for a policy that ended", () => {
    const [ended] = policyRows(
      wallet(
        [rule(SOL, { active_until: at(2026, 11, 17, 23) })],
        [provider({ state: "behind", ready: true })],
      ),
      null,
      NOW,
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
  const held = (extra: Partial<AomiRulesEnforcement> = {}) =>
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

  it("makes a row of an entry whose rule is gone, from what its id and the catalog say", () => {
    const [row, ...rest] = removedPolicies(wallet([], [held()]), catalog);
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
    const SENT =
      "Your revocation is signed. Send it from your wallet to take the grant off chain, or wait for Aomi to send it where the network supports that.";
    const send = (extra: Partial<AomiRulesEnforcement>) =>
      removedPolicies(wallet([], [held(extra)]), catalog)[0]!.enforcement;
    expect(send({ note: SENT })).toMatchObject({
      deploy: `metamask:eip155:8453:${REMOVED}`,
      send: true,
    });
    // Signed but nothing to send from here (not ready), still to sign, or
    // the relay's older wording: none of them is a send.
    expect(send({ note: SENT, ready: false })).not.toHaveProperty("send");
    expect(send({ note: NOTE })).not.toHaveProperty("send");
    expect(send({ note: null })).not.toHaveProperty("send");
    expect(
      send({
        note: "Your revocation is signed. It takes effect once it is sent: Aomi sends it where the network supports that, otherwise any account can. Until then the grant stays valid on chain.",
      }),
    ).not.toHaveProperty("send");
  });

  it("reads a destination of any app, or an address, and the Solana chain", () => {
    const [any, address] = removedPolicies(
      wallet(
        [],
        [
          provider({ rule: `${SOL}@any`, state: "behind", ready: true }),
          provider({
            rule: `${SOL}@address:${SWIG_WALLET}`,
            state: "behind",
            ready: true,
            left: "2500000000",
          }),
        ],
      ),
      catalog,
    );
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
    const [row] = removedPolicies(
      wallet(
        [],
        [
          held({
            rule: "eip155:10/erc20:0x0b2c639c533813f4aa9d7837caf62653d097ff85@protocol:velodrome",
            network: "eip155:10",
          }),
        ],
      ),
      catalog,
    );
    expect(row).toMatchObject({
      symbol: "0x0b2c…ff85",
      to: { kind: "app", id: "velodrome", label: "Velodrome" },
      chain: { label: "Optimism" },
    });
    // No decimals to read it by: the chain's number as it is.
    expect(row!.enforcement.left).toBe("5000000 0x0b2c…ff85 left");
    // Without the catalog at all, the same.
    expect(removedPolicies(wallet([], [held()]))[0]).toMatchObject({
      symbol: "0x8335…2913",
      to: { label: "Aave" },
    });
  });

  it("ignores an entry that is off, and an entry for a rule that is still current", () => {
    const rules = wallet(
      [rule(BASE_USDC, { id: REMOVED })],
      [
        // A provider that declined, and one not on chain yet.
        held({ state: "off", ready: false, left: null }),
        held({ rule: `${SOL}@any`, state: "off", ready: true, left: null }),
        // The rule is current: its own row shows this entry, not a removed one.
        held(),
      ],
    );
    expect(removedPolicies(rules, catalog)).toEqual([]);
    expect(removedPolicies(wallet([], [held({ state: "off" })]))).toEqual([]);
  });

  it("gives every entry its own row, offers the step only where it is ready, and warns where the chain could not be read", () => {
    const other = `${BASE_USDC}@any`;
    const rows = removedPolicies(
      wallet(
        [],
        [
          held(),
          held({ rule: other }),
          held({ rule: `${SOL}@any`, ready: false, state: "unverified" }),
        ],
      ),
      catalog,
    );
    expect(rows.map((row) => row.id)).toEqual([REMOVED, other, `${SOL}@any`]);
    expect(rows.map((row) => row.enforcement.deploy !== undefined)).toEqual([
      true,
      true,
      false,
    ]);
    expect(rows[2]!.enforcement.warning).toEqual({ label: "Not verified" });
  });

  it("is no live policy: the rows and the count are the rules' alone", () => {
    const rules = wallet([rule(SOL)], [held()]);
    expect(policyRows(rules, catalog, NOW)).toHaveLength(1);
    expect(activePolicyCount(rules, NOW)).toBe(1);
    expect(removedPolicies(rules, catalog)).toHaveLength(1);
  });
});

describe("the picker's providers", () => {
  const swig = {
    provider: "swig",
    name: "Swig",
    network: "solana:mainnet-beta",
    holds: "total_period_and_destination" as const,
    note: null,
  };
  it("reads each network's provider from the backend's list, rule or not", () => {
    expect(
      policyProviders({
        providers: [
          swig,
          {
            ...swig,
            provider: "metamask",
            name: "MetaMask",
            network: "eip155:1",
            holds: "total_and_period",
          },
          {
            ...swig,
            provider: "metamask",
            name: "MetaMask",
            network: "eip155:10",
            holds: "total_and_period",
          },
        ],
        enforcement: [],
      }),
    ).toEqual({
      "solana:mainnet-beta": {
        name: "Swig",
        holds: "total_period_and_destination",
      },
      "eip155:1": { name: "MetaMask", holds: "total_and_period" },
      "eip155:10": { name: "MetaMask", holds: "total_and_period" },
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

  it("lists one token with its chains and each contract's explorer page", () => {
    expect(catalog.tokens.map((token) => token.symbol)).toEqual([
      "USDC",
      "SOL",
    ]);
    expect(catalog.tokens[0]!.chains[0]).toEqual({
      chain: { label: "Base", network: "eip155:8453" },
      asset: BASE_USDC,
      decimals: 6,
      address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      explorer:
        "https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    });
    // A native token has no contract.
    expect(catalog.tokens[1]!.chains[0]).not.toHaveProperty("address");
  });

  it("makes one rule per chain, ending at the end of the chosen local day", () => {
    const rules = draftRules({
      symbol: "USDC",
      amount: "12.5",
      chains: catalog.tokens[0]!.chains,
      to: { kind: "app", id: "uniswap", label: "Uniswap" },
      activeUntil: "2026-12-11",
    });
    const end = endOfLocalDay("2026-12-11");
    expect(new Date(end * 1000).getHours()).toBe(23);
    expect(new Date(end * 1000).getMinutes()).toBe(59);
    expect(localDay(end)).toBe("2026-12-11");
    expect(localDay(end + 1)).toBe("2026-12-12");
    expect(rules).toEqual([
      {
        asset: BASE_USDC,
        amount: "12500000",
        to: { kind: "protocol", id: "uniswap" },
        active_until: end,
      },
      {
        asset: OP_USDC,
        amount: "12500000",
        to: { kind: "protocol", id: "uniswap" },
        active_until: end,
      },
    ]);
    // Always on sends no end; more digits than the token holds is refused.
    expect(
      draftRules({
        symbol: "SOL",
        amount: "1",
        chains: catalog.tokens[1]!.chains,
        to: { kind: "any_app" },
        activeUntil: null,
      }),
    ).toEqual([
      { asset: SOL, amount: "1000000000", to: { kind: "any_protocol" } },
    ]);
    expect(
      draftRules({
        symbol: "USDC",
        amount: "0.0000001",
        chains: catalog.tokens[0]!.chains,
        to: { kind: "any_app" },
        activeUntil: null,
      }),
    ).toBeNull();
  });

  it("counts days on the local calendar", () => {
    expect(dayFromToday(1, new Date(2026, 11, 31, 23, 30))).toBe("2027-01-01");
    expect(dayFromToday(0, new Date(2026, 10, 18, 0, 5))).toBe("2026-11-18");
  });
});
