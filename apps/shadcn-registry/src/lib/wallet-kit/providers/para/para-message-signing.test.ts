import { hashMessage, hashTypedData, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { hexToBase64 } from "../../account/encoding";
import {
  findParaSigningWallet,
  signParaMessage,
  signParaTypedData,
  signParaSolanaMessage,
} from "./para-message-signing";

const ADDRESS = "0x161c71bc74f385683d99eee41806dcc0d480a202" as const;
const SIGNATURE =
  "0x111111111111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222222222221b" as const;

describe("Para exact-wallet authorization", () => {
  const first = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const second = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const typedData = {
    domain: { name: "AomiAuthorization", version: "1" },
    types: { Permit: [{ name: "wallet", type: "string" as const }] },
    primaryType: "Permit" as const,
    message: { wallet: second.address },
  };

  it("uses the requested wallet ID and signs the EIP-712 digest exactly once", async () => {
    const signMessage = vi.fn(
      async ({
        walletId,
        messageBase64,
      }: {
        walletId: string;
        messageBase64: string;
      }) => {
        const account = walletId === "second" ? second : first;
        return {
          signature: (
            await account.sign({
              hash: `0x${Buffer.from(messageBase64, "base64").toString("hex")}`,
            })
          ).slice(2),
        };
      },
    );
    const para = {
      wallets: {
        first: { id: "first", address: first.address, type: "EVM" },
        second: { id: "second", address: second.address, type: "EVM" },
      },
      signMessage,
    };
    const result = await signParaTypedData(para, second.address.toLowerCase(), {
      typed_data: typedData,
    });
    expect(signMessage).toHaveBeenCalledWith({
      walletId: "second",
      messageBase64: hexToBase64(hashTypedData(typedData)),
    });
    expect(
      await recoverTypedDataAddress({
        ...typedData,
        signature: result.signature as `0x${string}`,
      }),
    ).toBe(second.address);
  });

  it("rejects a provider signature made by a different wallet", async () => {
    const para = {
      wallets: {
        second: { id: "second", address: second.address, type: "EVM" },
      },
      signMessage: vi.fn(async () => ({
        signature: await first.signTypedData(typedData),
      })),
    };
    await expect(
      signParaTypedData(para, second.address, { typed_data: typedData }),
    ).rejects.toThrow("different wallet");
  });

  it("passes Solana bytes unchanged and returns a base64 Ed25519 signature", async () => {
    const signature = hexToBase64("ab".repeat(64));
    const signMessage = vi.fn(async () => ({ signature }));
    const para = {
      wallets: { sol: { id: "sol", address: "AqK8Wallet", type: "SOLANA" } },
      signMessage,
    };
    expect(findParaSigningWallet(para, "aqk8wallet", "svm")).toBeUndefined();
    await expect(
      signParaSolanaMessage(para, "AqK8Wallet", "cGVybWl0"),
    ).resolves.toEqual({ signature });
    expect(signMessage).toHaveBeenCalledWith({
      walletId: "sol",
      messageBase64: "cGVybWl0",
    });
    await expect(
      signParaSolanaMessage(para, "AnotherWallet", "cGVybWl0"),
    ).rejects.toThrow("not available");
    expect(signMessage).toHaveBeenCalledOnce();
  });
});

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
