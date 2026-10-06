import { describe, expect, it, vi } from "vitest";
import { bindWalletVia } from "@/wallet/wallet-bind";

describe("bindWalletVia", () => {
  it("runs challenge → sign → commit for EVM bind", async () => {
    const post = vi.fn(async (path: string, _body: unknown): Promise<never> => {
      if (path.endsWith("/challenge")) {
        return {
          permit: { wallet: "0xabc", mode: "bind" },
          typed_data: { primaryType: "AuthorizationPermit" },
        } as never;
      }
      return {
        address: "0xabc",
        chain_type: "evm",
        signing_mode: "manual",
      } as never;
    });
    const signTypedData = vi.fn(async () => ({ signature: "0xsig" }));

    await expect(
      bindWalletVia(post, {
        chain: "evm",
        address: "0xabc",
        signTypedData,
      }),
    ).resolves.toBe("bound");

    expect(post).toHaveBeenCalledWith("/api/account/authorization/challenge", {
      chain_type: "evm",
      wallet: "0xabc",
      mode: "bind",
    });
    expect(signTypedData).toHaveBeenCalledOnce();
  });

  it("returns already_bound when the wallet is linked", async () => {
    const post = vi.fn(async () => {
      throw new Error('{"error":"already_bound"}');
    });

    await expect(
      bindWalletVia(post, {
        chain: "evm",
        address: "0xabc",
        signTypedData: vi.fn(),
      }),
    ).resolves.toBe("already_bound");
  });
});
