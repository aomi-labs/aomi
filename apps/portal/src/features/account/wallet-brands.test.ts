import { describe, expect, it } from "vitest";
import { resolveWalletBrandKey } from "./wallet-brands";

describe("resolveWalletBrandKey", () => {
  it("recognizes persisted numbered wallet labels", () => {
    expect(resolveWalletBrandKey("Rabby 1")).toBe("rabby");
    expect(resolveWalletBrandKey("MetaMask 2")).toBe("metamask");
    expect(resolveWalletBrandKey("WalletConnect 1")).toBe("walletconnect");
  });

  it("recognizes provider wallets and ignores unknown transport names", () => {
    expect(resolveWalletBrandKey("Privy embedded wallet")).toBe("privy");
    expect(resolveWalletBrandKey("Para")).toBe("para");
    expect(resolveWalletBrandKey("siwe")).toBeNull();
  });
});
