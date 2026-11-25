import { describe, expect, it } from "vitest";
import {
  assetChain,
  catalogOn,
  fromBaseUnits,
  policyFromDraft,
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

  it("narrows the catalog to one chain, and drops a policy by its id", () => {
    expect(catalogOn(catalog, "Ethereum")).toEqual({
      apps: [catalog.apps[2]],
      tokens: catalog.tokens.slice(2),
    });
    expect(() => catalogOn(catalog, "tron")).toThrow("no chain tron");
    const policy = {
      asset: SOL,
      amount: "1",
      to: { kind: "any_protocol" },
    } as const;
    expect(
      withoutPolicy([policy, { ...policy, id: "other" }], "other"),
    ).toEqual([policy]);
  });
});
