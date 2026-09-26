import { describe, expect, it } from "vitest";
import { normalizeEvmWalletTarget } from "../src";

describe("wallet target boundary", () => {
  it("preserves valid target spelling and normalizes the same mixed-case bytes", () => {
    const lower = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const mixed = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
    expect(normalizeEvmWalletTarget(lower)).toBe(lower);
    expect(normalizeEvmWalletTarget(mixed).toLowerCase()).toBe(lower);
  });

  it.each([
    "0x1234",
    "0x" + "g".repeat(40),
    "a".repeat(40),
    "0x" + "a".repeat(42),
  ])("rejects malformed address %s", (target) => {
    expect(() => normalizeEvmWalletTarget(target)).toThrow();
  });
});
