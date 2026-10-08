import { describe, expect, it, vi } from "vitest";
import {
  keccak256,
  parseTransaction,
  recoverMessageAddress,
  recoverTransactionAddress,
  verifyTypedData,
  type Hex,
} from "viem";
import { generatePrivateKey } from "viem/accounts";
import type { SignableCommit } from "@aomi-labs/client";
import {
  broadcastWithReplay,
  createViemWalletFromEnvironment,
} from "./viem-wallet";

const chainId = 31337;

function testWallet() {
  const wallet = createViemWalletFromEnvironment({
    AOMI_PRIVATE_KEY: generatePrivateKey(),
    EVM_CHAIN_ID: String(chainId),
    EVM_RPC_URL: "http://127.0.0.1:8545",
  })?.evm;
  if (!wallet) throw new Error("test wallet missing");
  return wallet;
}

describe("headless Viem wallet adapter", () => {
  it("signs exact personal-message bytes without an RPC call", async () => {
    const wallet = testWallet();
    const message = "0x01020304";
    const signature = await wallet.signMessage?.({ message });
    expect(typeof signature).toBe("string");
    expect(
      await recoverMessageAddress({
        message: { raw: message },
        signature: signature as Hex,
      }),
    ).toBe(wallet.address);
  });

  it("signs literal personal-message text as UTF-8 instead of treating it as hex", async () => {
    const wallet = testWallet();
    const message = "Aomi signing test";
    const signature = await wallet.signMessage?.({ message });
    expect(
      await recoverMessageAddress({
        message,
        signature: signature as Hex,
      }),
    ).toBe(wallet.address);
  });

  it("signs EIP-712 data for the configured wallet", async () => {
    const wallet = testWallet();
    const typedData = {
      domain: { name: "Aomi test", version: "1", chainId },
      types: { Permit: [{ name: "nonce", type: "uint256" }] },
      primaryType: "Permit",
      message: { nonce: 7n },
    } as const;
    const signature = await wallet.signTypedData?.({
      typedData: typedData as unknown as Record<string, unknown>,
    });
    expect(
      await verifyTypedData({
        address: wallet.address as Hex,
        ...typedData,
        signature: signature as Hex,
      }),
    ).toBe(true);
  });

  it("signs the exact prepared EVM nonce and fees without broadcasting", async () => {
    const wallet = testWallet();
    const payload: Extract<SignableCommit, { kind: "evm_transaction" }> = {
      kind: "evm_transaction",
      chain_id: chainId,
      signer: wallet.address,
      nonce: 7,
      transaction: {
        to: "0x0000000000000000000000000000000000000001",
        value: "9",
        data: "0x1234",
        gas_limit: 25000,
        max_fee_per_gas: "1000000000",
        max_priority_fee_per_gas: "1000000",
      },
    };

    const signed = await wallet.signTransaction?.(payload);
    expect(signed).toBeDefined();
    const transaction = parseTransaction(signed as Hex);
    expect(transaction.chainId).toBe(chainId);
    expect(transaction.nonce).toBe(7);
    expect(transaction.value).toBe(9n);
    expect(transaction.gas).toBe(25000n);
    expect(transaction.maxFeePerGas).toBe(1000000000n);
    expect(transaction.maxPriorityFeePerGas).toBe(1000000n);
    expect(transaction.data).toBe("0x1234");
    expect(
      await recoverTransactionAddress({
        serializedTransaction: signed as Parameters<
          typeof recoverTransactionAddress
        >[0]["serializedTransaction"],
      }),
    ).toBe(wallet.address);

    await expect(
      wallet.signTransaction?.({ ...payload, chain_id: 1 }),
    ).rejects.toThrow("configured for chain 31337");
  });

  it("does not resend exact signed bytes already known to the chain", async () => {
    const signed = "0x02c0" as Hex;
    const hash = keccak256(signed);
    const exists = vi.fn(async () => true);
    const send = vi.fn(async () => hash);

    expect(await broadcastWithReplay(signed, exists, send)).toBe(hash);
    expect(exists).toHaveBeenCalledWith(hash);
    expect(send).not.toHaveBeenCalled();
  });

  it("recovers an ambiguous send error only when the exact signed transaction is found", async () => {
    const signed = "0x02c0" as Hex;
    const hash = keccak256(signed);
    const exists = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const error = new Error("RPC connection lost after submission");
    const send = vi.fn(async () => {
      throw error;
    });

    expect(await broadcastWithReplay(signed, exists, send)).toBe(hash);
    expect(exists).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledExactlyOnceWith(signed);
  });

  it("rethrows a failed send when no matching transaction can be found", async () => {
    const signed = "0x02c0" as Hex;
    const error = new Error("RPC rejected the transaction");
    await expect(
      broadcastWithReplay(
        signed,
        async () => false,
        async () => {
          throw error;
        },
      ),
    ).rejects.toBe(error);
  });
});
