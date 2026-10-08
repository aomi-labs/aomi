import { describe, expect, it } from "vitest";
import {
  canLinkWalletBySignature,
  normalizeWalletAddress,
  walletKey,
} from "./wallet-utils";

describe("wallet normalization", () => {
  it("compares EVM addresses case-insensitively", () => {
    expect(normalizeWalletAddress("evm", "0xAbC123")).toBe("0xabc123");
    expect(walletKey("evm", "0xAbC123")).toBe(walletKey("evm", "0xabc123"));
  });

  it("preserves SVM address case", () => {
    expect(normalizeWalletAddress("svm", "AbC123")).toBe("AbC123");
    expect(walletKey("svm", "AbC123")).not.toBe(walletKey("svm", "abc123"));
  });
});

describe("canLinkWalletBySignature", () => {
  it("links any EVM wallet, embedded included", () => {
    expect(canLinkWalletBySignature("evm", "embedded")).toBe(true);
    expect(canLinkWalletBySignature("evm", undefined)).toBe(true);
  });

  it("links only external Solana wallets", () => {
    expect(canLinkWalletBySignature("svm", "external")).toBe(true);
    expect(canLinkWalletBySignature("svm", undefined)).toBe(true);
    expect(canLinkWalletBySignature("svm", "embedded")).toBe(false);
    expect(canLinkWalletBySignature("svm", "smart_account")).toBe(false);
  });
});
