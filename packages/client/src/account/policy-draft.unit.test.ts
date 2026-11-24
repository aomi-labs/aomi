import { describe, expect, it } from "vitest";
import { policyFromDraft, toBaseUnits, upsertPolicy } from "./policy-draft";

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
});
