import { hashMessage } from "viem";
import { describe, expect, it, vi } from "vitest";
import { hexToBase64 } from "../../account/encoding";
import { signParaMessage } from "./para-message-signing";

const ADDRESS = "0x161c71bc74f385683d99eee41806dcc0d480a202" as const;
const SIGNATURE =
  "0x111111111111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222222222221b" as const;

describe("signParaMessage", () => {
  it("normalizes Para's already-prefixed signature without adding a second prefix", async () => {
    const signMessage = vi.fn(async () => ({ signature: SIGNATURE }));
    const para = {
      findWalletByAddress: vi.fn(() => ({ id: "wallet-1" })),
      signMessage,
    };

    await expect(
      signParaMessage(para, ADDRESS, "confirm harmless message"),
    ).resolves.toBe(SIGNATURE);
    expect(para.findWalletByAddress).toHaveBeenCalledWith(ADDRESS, {
      type: ["EVM"],
    });
    expect(signMessage).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: "wallet-1" }),
    );
  });

  it("fails clearly when the address is not an embedded Para wallet", async () => {
    await expect(signParaMessage({}, ADDRESS, "message")).rejects.toThrow(
      "Para embedded wallet is not available for signing",
    );
  });

  it("hashes Alchemy personal_sign hex as raw bytes", async () => {
    const signMessage = vi.fn(async () => ({ signature: SIGNATURE }));
    const para = {
      findWalletByAddress: vi.fn(() => ({ id: "wallet-1" })),
      signMessage,
    };
    const message =
      "0xa561ab5fcf731e2d172f3f8cc8cfd0a4dcb20f10c152a0567d74249607806da9" as const;

    await signParaMessage(para, ADDRESS, message);

    expect(signMessage).toHaveBeenCalledWith({
      walletId: "wallet-1",
      messageBase64: hexToBase64(hashMessage({ raw: message })),
    });
  });
});
