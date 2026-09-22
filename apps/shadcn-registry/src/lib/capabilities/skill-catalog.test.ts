import { describe, expect, it } from "vitest";
import { conciseSkillDescription } from "./skill-catalog";

describe("conciseSkillDescription", () => {
  it("removes picker boilerplate and redundant chain prose", () => {
    expect(
      conciseSkillDescription(
        "Use when users want to supply, borrow, repay, or withdraw on Aave V3 on Ethereum, Optimism, Polygon, Base, or Arbitrum.",
      ),
    ).toBe("Supply, borrow, repay, or withdraw on Aave V3");
    expect(
      conciseSkillDescription(
        "Use when the user wants fast cross-chain bridging via Across Protocol — intent-based relayer fill between networks.",
      ),
    ).toBe("Fast cross-chain bridging");
  });

  it("normalizes token terminology and caps unusually long summaries", () => {
    const summary = conciseSkillDescription(
      "Use when users want to bridge ERC20 tokens with a highly specialized workflow that contains far too much detail for one compact picker row.",
    );

    expect(summary).toContain("ERC-20");
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(64);
  });
});
