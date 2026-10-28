import { describe, expect, it, vi } from "vitest";
import { buildPrivySvmWalletState } from "./privy-svm";

describe("buildPrivySvmWalletState", () => {
  it("marks Privy Solana wallets as embedded transport", () => {
    const wallet = {
      address: "AG6eZ1iXAhp8uzaXabn7eSZfaXBWrMYtvBH5dTzww18E",
      signMessage: vi.fn(),
      signTransaction: vi.fn(),
      sendTransaction: vi.fn(),
    };

    expect(
      buildPrivySvmWalletState({
        wallet: wallet as never,
        wallets: [wallet] as never,
        setActiveAddress: vi.fn(),
      }).transport,
    ).toBe("embedded");
  });

  it("signs through Privy's modal, not the wallet's silent call", async () => {
    const wallet = {
      address: "AG6eZ1iXAhp8uzaXabn7eSZfaXBWrMYtvBH5dTzww18E",
      signTransaction: vi.fn(),
    };
    const signWithPrivy = vi.fn(async () => "signed");
    const state = buildPrivySvmWalletState({
      wallet: wallet as never,
      wallets: [wallet] as never,
      setActiveAddress: vi.fn(),
      signWithPrivy,
    });
    expect(await state.signTransaction!("tx" as never)).toBe("signed");
    expect(signWithPrivy).toHaveBeenCalledWith("tx", wallet.address);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });
});
