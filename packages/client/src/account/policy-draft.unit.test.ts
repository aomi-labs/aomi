import { describe, expect, it } from "vitest";
import {
  AomiPolicyFieldError,
  assetChain,
  catalogOn,
  checkPolicy,
  fromBaseUnits,
  policyFromDraft,
  policyFromInput,
  toBaseUnits,
  upsertPolicy,
  withoutPolicy,
} from "./policy-draft";

const SOL = "solana:mainnet-beta/native";
const USDC = "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const catalog = {
  apps: [
    { id: "jupiter", label: "Jupiter", chains: ["solana:mainnet-beta"] },
    { id: "jito", label: "Jito", chains: ["solana:mainnet-beta"] },
    { id: "uniswap", label: "Uniswap", chains: ["eip155:8453", "eip155:1"] },
  ],
  tokens: [
    { asset: SOL, symbol: "SOL", decimals: 9, chain: "Solana" },
    { asset: USDC, symbol: "USDC", decimals: 6, chain: "Base" },
    { asset: "eip155:1/native", symbol: "ETH", decimals: 18, chain: "" },
    {
      asset: "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      symbol: "USDC",
      decimals: 6,
      chain: "Ethereum",
    },
  ],
};
const NOW = Date.UTC(2026, 0, 1);
/** The field a refused policy names, with the nearest catalog values. */
const refused = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof AomiPolicyFieldError)
      return [error.field, ...error.nearest];
    throw error;
  }
  return null;
};

describe("policy drafts", () => {
  it("converts human amounts with string math, past 2^53", () => {
    expect(toBaseUnits("0.5", 9)).toBe("500000000");
    expect(toBaseUnits("200", 6)).toBe("200000000");
    expect(toBaseUnits("12345678901234567890.000000000000000001", 18)).toBe(
      "12345678901234567890000000000000000001",
    );
    expect(toBaseUnits(".5", 1)).toBe("5");
    expect(toBaseUnits("0.1234567", 6)).toBeNull();
    expect(toBaseUnits("1e3", 6)).toBeNull();
    expect(toBaseUnits("", 6)).toBeNull();
    // A comma only groups thousands; "1,2" is a typo, not 12.
    expect(toBaseUnits("1,250.5", 6)).toBe("1250500000");
    expect(toBaseUnits("1,234,567", 0)).toBe("1234567");
    expect(toBaseUnits("1,2", 6)).toBeNull();
    expect(toBaseUnits("12,34", 6)).toBeNull();
    expect(toBaseUnits(",5", 6)).toBeNull();
  });

  it("writes a draft as a policy and puts it in place of the one with its key", () => {
    const to = { kind: "any_protocol" } as const;
    const draft = { asset: "solana:mainnet-beta/native", decimals: 9, to };
    const policy = policyFromDraft({ ...draft, amount: "1", activeUntil: 9 });
    expect(policy).toEqual({
      asset: draft.asset,
      amount: "1000000000",
      to,
      active_until: 9,
    });
    expect(policyFromDraft({ ...draft, amount: "2" })).not.toHaveProperty(
      "active_until",
    );
    expect(policyFromDraft({ ...draft, amount: "0.0000000001" })).toBeNull();
    const other = { asset: "eip155:8453/native", amount: "5", to };
    const held = [other, { ...policy!, amount: "7" }];
    expect(upsertPolicy(held, policy!)).toEqual([other, policy]);
    expect(upsertPolicy([other], policy!)).toEqual([other, policy]);
  });

  it("reads base units back, and names an asset's chain", () => {
    expect(fromBaseUnits("500000000", 9)).toBe("0.5");
    expect(fromBaseUnits("12345678901234567890000000000000000001", 18)).toBe(
      "12345678901234567890.000000000000000001",
    );
    expect(fromBaseUnits("0", 6)).toBe("0");
    expect(assetChain(USDC, catalog)).toBe("Base");
    expect(assetChain("eip155:1/native", catalog)).toBe("Ethereum");
    expect(assetChain("eip155:999999/native")).toBe("Chain 999999");
    expect(assetChain("solana:devnet/native")).toBe("Solana");
  });

  it("makes the same policy from what a person types, resolved in the catalog", () => {
    const typed = policyFromInput(
      { amount: "0.5", asset: "sol", to: "Jupiter", until: "2026-12-11" },
      catalog,
      NOW,
    );
    expect(typed).toEqual({
      asset: SOL,
      amount: "500000000",
      to: { kind: "protocol", id: "jupiter" },
      active_until: Date.UTC(2026, 11, 11, 23, 59, 59) / 1000,
    });
    expect(
      checkPolicy({ ...typed, id: "x", symbol: "SOL" }, catalog, NOW),
    ).toEqual(typed);
    const address = "0x00000000000000000000000000000000000000Aa";
    for (const chain of ["base", "8453", "eip155:8453"])
      expect(
        policyFromInput(
          { amount: "1,000", asset: "USDC", to: address, chain },
          catalog,
          NOW,
        ),
      ).toEqual({
        asset: USDC,
        amount: "1000000000",
        to: { kind: "address", address },
      });
    expect(
      policyFromInput({ amount: "0", asset: SOL, to: "any" }, catalog, NOW).to,
    ).toEqual({ kind: "any_protocol" });
    expect(catalogOn(catalog, "Ethereum")).toEqual({
      apps: [catalog.apps[2]],
      tokens: catalog.tokens.slice(2),
    });
    expect(withoutPolicy([typed, { ...typed, id: "other" }], "other")).toEqual([
      typed,
    ]);
  });

  it("finds a typed app by its id first, then by its label among the apps on the token's chain", () => {
    const apps = [
      { id: "swap-eth", label: "Swap", chains: ["eip155:1"] },
      { id: "swap-base", label: "Swap", chains: ["eip155:8453"] },
      {
        id: "jupiter-legacy",
        label: "Jupiter",
        chains: ["solana:mainnet-beta"],
      },
      ...catalog.apps,
    ];
    const to = (input: { asset: string; to: string; chain?: string }) =>
      policyFromInput({ amount: "1", ...input }, { ...catalog, apps }, NOW).to;
    // The label is on two chains: the token's chain picks.
    expect(to({ asset: "USDC", to: "Swap", chain: "base" })).toEqual({
      kind: "protocol",
      id: "swap-base",
    });
    // An id wins over another app's label, wherever each is listed.
    expect(to({ asset: "SOL", to: "jupiter" })).toEqual({
      kind: "protocol",
      id: "jupiter",
    });
    // An id named outright is not swapped for a namesake on the right chain.
    expect(
      refused(() => to({ asset: "USDC", to: "swap-eth", chain: "base" })),
    ).toEqual(["to.id", "swap-base"]);
  });

  it("refuses a policy by the field that is wrong, with the nearest apps", () => {
    const typed = (input: object) => () =>
      policyFromInput(
        { amount: "1", asset: "SOL", to: "any", ...input },
        catalog,
        NOW,
      );
    expect(refused(typed({ to: "jupitr" }))).toEqual(["to.id", "jupiter"]);
    expect(refused(typed({ to: "j" }))).toEqual(["to.id", "jupiter", "jito"]);
    // An app on another chain is not this token's.
    expect(refused(typed({ to: "uniswap" }))).toEqual(["to.id"]);
    expect(refused(typed({ amount: "1.0000000001" }))).toEqual(["amount"]);
    expect(refused(typed({ asset: "USDC" }))).toEqual(["chain"]);
    expect(refused(typed({ asset: "DOGE" }))).toEqual(["asset"]);
    expect(refused(typed({ chain: "tron" }))).toEqual(["chain"]);
    expect(refused(typed({ until: "2026-02-30" }))).toEqual(["until"]);
    expect(refused(typed({ until: "2025-12-31" }))).toEqual(["active_until"]);
    const sent = (policy: unknown) => () => checkPolicy(policy, catalog, NOW);
    const any = { kind: "any_protocol" };
    expect(refused(sent([]))).toEqual(["policy"]);
    expect(refused(sent({ asset: "SOL", amount: "1", to: any }))).toEqual([
      "asset",
    ]);
    expect(refused(sent({ asset: SOL, amount: 1, to: any }))).toEqual([
      "amount",
    ]);
    expect(refused(sent({ asset: SOL, amount: "1" }))).toEqual(["to.kind"]);
    expect(
      refused(
        sent({
          asset: SOL,
          amount: "1",
          to: { kind: "address", address: "0x00" },
        }),
      ),
    ).toEqual(["to.address"]);
    expect(
      refused(sent({ asset: SOL, amount: "1", to: any, daily: "1" })),
    ).toEqual(["daily"]);
  });
});
