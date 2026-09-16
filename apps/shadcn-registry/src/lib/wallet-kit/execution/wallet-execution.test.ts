import { describe, expect, it, vi } from "vitest";
import { mainnet } from "viem/chains";
import { type WalletTxPayload } from "@aomi-labs/react";

import { executeWalletKitTransaction } from "./wallet-execution";

const CALLS: NonNullable<WalletTxPayload["calls"]> = [
  {
    txId: 1,
    to: "0x1111111111111111111111111111111111111111",
    value: "1",
    data: "0x",
    chainId: 1,
  },
  {
    txId: 0,
    to: "0x2222222222222222222222222222222222222222",
    value: "2",
    data: "0x",
    chainId: 1,
  },
];

function strictFeeBatchPayload(): WalletTxPayload {
  return {
    aaPreference: "eip7702",
    aaStrict: true,
    calls: CALLS,
  };
}

function optionalFeeBatchPayload(): WalletTxPayload {
  return {
    aaPreference: "eip7702",
    aaStrict: false,
    calls: CALLS,
  };
}

function singleCallPayload(): WalletTxPayload {
  return {
    to: "0x1111111111111111111111111111111111111111",
    value: "1",
    data: "0x",
    chainId: 1,
  };
}

describe("executeWalletKitTransaction native execution", () => {
  it("switches when the connected wallet chain is unknown", async () => {
    const switchChainAsync = vi.fn(async () => undefined);
    const sendTransactionAsync = vi.fn().mockResolvedValue("0x111");

    await executeWalletKitTransaction({
      payload: singleCallPayload(),
      state: {
        currentChainId: undefined,
        sendCallsSyncAsync: vi.fn(),
        sendTransactionAsync,
        switchChainAsync,
        chainsById: { [mainnet.id]: mainnet },
        waitForTransactionReceipt: vi
          .fn()
          .mockResolvedValue({ status: "success" }),
      },
    });

    expect(switchChainAsync).toHaveBeenCalledWith({ chainId: 1 });
    expect(switchChainAsync.mock.invocationCallOrder[0]).toBeLessThan(
      sendTransactionAsync.mock.invocationCallOrder[0],
    );
  });

  it("does not switch when the connected wallet is already on the target chain", async () => {
    const switchChainAsync = vi.fn(async () => undefined);

    await executeWalletKitTransaction({
      payload: singleCallPayload(),
      state: {
        currentChainId: 1,
        sendCallsSyncAsync: vi.fn(),
        sendTransactionAsync: vi.fn().mockResolvedValue("0x111"),
        switchChainAsync,
        chainsById: { [mainnet.id]: mainnet },
        waitForTransactionReceipt: vi
          .fn()
          .mockResolvedValue({ status: "success" }),
      },
    });

    expect(switchChainAsync).not.toHaveBeenCalled();
  });

  it("executes batches sequentially when the wallet has no atomic capability", async () => {
    const sendTransactionAsync = vi
      .fn()
      .mockResolvedValueOnce("0x111")
      .mockResolvedValueOnce("0x222");
    const sendCallsSyncAsync = vi.fn();
    const waitForTransactionReceipt = vi
      .fn()
      .mockResolvedValue({ status: "success" });

    const result = await executeWalletKitTransaction({
      payload: optionalFeeBatchPayload(),
      state: {
        currentChainId: 1,
        sendCallsSyncAsync,
        sendTransactionAsync,
        switchChainAsync: vi.fn(),
        chainsById: { [mainnet.id]: mainnet },
        waitForTransactionReceipt,
      },
    });

    expect(sendCallsSyncAsync).not.toHaveBeenCalled();
    expect(sendTransactionAsync).toHaveBeenCalledTimes(2);
    expect(waitForTransactionReceipt).toHaveBeenCalledWith({
      chainId: 1,
      hash: "0x111",
    });
    expect(waitForTransactionReceipt).toHaveBeenCalledWith({
      chainId: 1,
      hash: "0x222",
    });
    expect(result).toMatchObject({
      txHash: "0x222",
      aaRequestedMode: "7702",
      aaResolvedMode: "none",
      aaFallbackReason: "aa_unavailable_fallback_eoa",
      executionKind: "eoa",
      batched: true,
      sponsored: false,
    });
  });

  it("waits for the confirmed prefix before requesting the next wallet signature", async () => {
    const events: string[] = [];
    const sendTransactionAsync = vi
      .fn()
      .mockImplementationOnce(async () => {
        events.push("send:first");
        return "0x111";
      })
      .mockImplementationOnce(async () => {
        events.push("send:second");
        return "0x222";
      });
    const waitForTransactionReceipt = vi
      .fn()
      .mockImplementation(async ({ hash }: { hash: string }) => {
        events.push(hash === "0x111" ? "wait:first" : "wait:second");
        return { status: "success" };
      });

    await executeWalletKitTransaction({
      payload: optionalFeeBatchPayload(),
      state: {
        currentChainId: 1,
        sendCallsSyncAsync: vi.fn(),
        sendTransactionAsync,
        switchChainAsync: vi.fn(),
        chainsById: { [mainnet.id]: mainnet },
        waitForTransactionReceipt,
      },
    });

    expect(events).toEqual([
      "send:first",
      "wait:first",
      "send:second",
      "wait:second",
    ]);
  });

  it("reports a confirmed prefix when a later sequential send fails", async () => {
    const sendTransactionAsync = vi
      .fn()
      .mockResolvedValueOnce("0x111")
      .mockRejectedValueOnce(new Error("fee send failed"));

    await expect(
      executeWalletKitTransaction({
        payload: optionalFeeBatchPayload(),
        state: {
          currentChainId: 1,
          sendCallsSyncAsync: vi.fn(),
          sendTransactionAsync,
          switchChainAsync: vi.fn(),
          chainsById: { [mainnet.id]: mainnet },
          waitForTransactionReceipt: vi
            .fn()
            .mockResolvedValue({ status: "success" }),
        },
      }),
    ).rejects.toMatchObject({
      message: "fee send failed",
      partial: {
        executedTxIds: [1],
        lastTxHash: "0x111",
        failedTxId: null,
        remainingTxIds: [],
      },
    });
  });

  it("still reports the broadcast prefix when a receipt wait times out", async () => {
    // The receipt wait can fail while the transaction mines anyway. Dropping
    // the leg from the partial would let the backend re-queue a transaction
    // that is already on chain, so a broadcast leg counts as executed.
    const sendTransactionAsync = vi.fn().mockResolvedValueOnce("0x111");

    await expect(
      executeWalletKitTransaction({
        payload: optionalFeeBatchPayload(),
        state: {
          currentChainId: 1,
          sendCallsSyncAsync: vi.fn(),
          sendTransactionAsync,
          switchChainAsync: vi.fn(),
          chainsById: { [mainnet.id]: mainnet },
          waitForTransactionReceipt: vi
            .fn()
            .mockRejectedValue(new Error("WaitForTransactionReceiptTimeout")),
        },
      }),
    ).rejects.toMatchObject({
      message: "WaitForTransactionReceiptTimeout",
      partial: { executedTxIds: [1], lastTxHash: "0x111" },
    });
    expect(sendTransactionAsync).toHaveBeenCalledTimes(1);
  });

  it("excludes a leg that mined reverted from the executed prefix", async () => {
    const sendTransactionAsync = vi.fn().mockResolvedValueOnce("0x111");

    const error = await executeWalletKitTransaction({
      payload: optionalFeeBatchPayload(),
      state: {
        currentChainId: 1,
        sendCallsSyncAsync: vi.fn(),
        sendTransactionAsync,
        switchChainAsync: vi.fn(),
        chainsById: { [mainnet.id]: mainnet },
        waitForTransactionReceipt: vi
          .fn()
          .mockResolvedValue({ status: "reverted" }),
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      message: "wallet_sequential_transaction_reverted",
    });
    expect(error).not.toHaveProperty("partial");
    expect(sendTransactionAsync).toHaveBeenCalledTimes(1);
  });

  it("reports a plain single-call send as none/none", async () => {
    const sendTransactionAsync = vi.fn().mockResolvedValue("0x111");

    const result = await executeWalletKitTransaction({
      payload: { ...singleCallPayload(), aaPreference: "none" },
      state: {
        currentChainId: 1,
        sendCallsSyncAsync: vi.fn(),
        sendTransactionAsync,
        switchChainAsync: vi.fn(),
        chainsById: { [mainnet.id]: mainnet },
        waitForTransactionReceipt: vi
          .fn()
          .mockResolvedValue({ status: "success" }),
      },
    });

    expect(sendTransactionAsync).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      txHash: "0x111",
      aaRequestedMode: "none",
      aaResolvedMode: "none",
      executionKind: "eoa",
      batched: false,
      sponsored: false,
    });
  });

  it("keeps Base Account atomic batching optional unless sponsorship is required", async () => {
    const sendCallsSyncAsync = vi
      .fn()
      .mockRejectedValue(
        new Error("Unsupported non-optional capabilities: atomic"),
      );
    const sendTransactionAsync = vi
      .fn()
      .mockResolvedValueOnce("0x111")
      .mockResolvedValueOnce("0x222");

    const result = await executeWalletKitTransaction({
      payload: optionalFeeBatchPayload(),
      state: {
        currentChainId: 1,
        capabilities: {
          "eip155:1": { atomic: { status: "ready" } },
        },
        nativeWalletExecution: {
          executionKind: "base_account_4337",
          sponsorship: { mode: "disabled" },
        },
        sendCallsSyncAsync,
        sendTransactionAsync,
        switchChainAsync: vi.fn(),
        chainsById: { [mainnet.id]: mainnet },
        waitForTransactionReceipt: vi
          .fn()
          .mockResolvedValue({ status: "success" }),
      },
    });

    expect(sendCallsSyncAsync).toHaveBeenCalledWith({
      chainId: 1,
      calls: expect.any(Array),
      capabilities: {
        atomic: { optional: true },
      },
      forceAtomic: false,
      status: expect.any(Function),
      throwOnFailure: true,
      timeout: undefined,
      version: undefined,
    });
    expect(sendTransactionAsync).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      txHash: "0x222",
      aaRequestedMode: "7702",
      aaResolvedMode: "none",
      executionKind: "eoa",
      batched: true,
      sponsored: false,
    });
  });

  it("requires sponsored atomic sendCalls for Base Account fee batches", async () => {
    const sendCallsSyncAsync = vi.fn().mockResolvedValue({
      receipts: [{ transactionHash: "0x111" }, { transactionHash: "0x222" }],
      status: "success",
    });
    const sendTransactionAsync = vi.fn();

    const result = await executeWalletKitTransaction({
      payload: strictFeeBatchPayload(),
      state: {
        currentChainId: 1,
        capabilities: {
          "eip155:1": {
            atomic: { status: "ready" },
            paymasterService: { supported: true },
          },
        },
        nativeWalletExecution: {
          executionKind: "base_account_4337",
          sendCallsVersion: "1.0",
          sendCallsTimeoutMs: 45_000,
          sponsorship: {
            mode: "required",
            getPaymasterServiceUrl: () => "https://paymaster.example.test",
          },
        },
        sendCallsSyncAsync,
        sendTransactionAsync,
        switchChainAsync: vi.fn(),
        chainsById: { [mainnet.id]: mainnet },
      },
    });

    expect(sendCallsSyncAsync).toHaveBeenCalledWith({
      chainId: 1,
      calls: expect.any(Array),
      capabilities: {
        atomic: { required: true },
        paymasterService: {
          url: "https://paymaster.example.test",
          context: {},
        },
      },
      forceAtomic: true,
      status: expect.any(Function),
      throwOnFailure: true,
      timeout: 45_000,
      version: "1.0",
    });
    expect(sendTransactionAsync).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      txHash: "0x222",
      aaRequestedMode: "7702",
      aaResolvedMode: "4337",
      executionKind: "base_account_4337",
      batched: true,
      sponsored: true,
    });
  });

  it("does not fall back to sequential sends when sponsored atomic sendCalls fails", async () => {
    const sendCallsSyncAsync = vi
      .fn()
      .mockRejectedValue(new Error("wallet_prepareCalls failed"));
    const sendTransactionAsync = vi.fn();

    await expect(
      executeWalletKitTransaction({
        payload: strictFeeBatchPayload(),
        state: {
          currentChainId: 1,
          capabilities: {
            "eip155:1": {
              atomic: { status: "ready" },
              paymasterService: { supported: true },
            },
          },
          nativeWalletExecution: {
            executionKind: "base_account_4337",
            sponsorship: {
              mode: "required",
              getPaymasterServiceUrl: () => "https://paymaster.example.test",
            },
          },
          sendCallsSyncAsync,
          sendTransactionAsync,
          switchChainAsync: vi.fn(),
          chainsById: { [mainnet.id]: mainnet },
        },
      }),
    ).rejects.toThrow("wallet_prepareCalls failed");

    expect(sendCallsSyncAsync).toHaveBeenCalledTimes(1);
    expect(sendTransactionAsync).not.toHaveBeenCalled();
  });

  it("does not submit the batch twice when an atomic sendCalls confirmation times out", async () => {
    const timeoutError = new Error(
      'Timed out while waiting for call bundle with id "0x123" to be confirmed.',
    );
    const sendCallsSyncAsync = vi.fn().mockRejectedValue(timeoutError);
    const sendTransactionAsync = vi.fn();

    await expect(
      executeWalletKitTransaction({
        payload: strictFeeBatchPayload(),
        state: {
          currentChainId: 1,
          capabilities: {
            "eip155:1": { atomic: { status: "ready" } },
          },
          sendCallsSyncAsync,
          sendTransactionAsync,
          switchChainAsync: vi.fn(),
          chainsById: { [mainnet.id]: mainnet },
        },
      }),
    ).rejects.toThrow("Timed out while waiting for call bundle");

    expect(sendCallsSyncAsync).toHaveBeenCalledTimes(1);
    expect(sendTransactionAsync).not.toHaveBeenCalled();
  });

  it("refuses to split an aaStrict batch into sequential sends", async () => {
    const sendTransactionAsync = vi.fn();

    await expect(
      executeWalletKitTransaction({
        payload: strictFeeBatchPayload(),
        state: {
          currentChainId: 1,
          // No atomic capability: sendCalls unusable, sequential is forbidden.
          sendCallsSyncAsync: vi.fn(),
          sendTransactionAsync,
          switchChainAsync: vi.fn(),
          chainsById: { [mainnet.id]: mainnet },
        },
      }),
    ).rejects.toThrow("wallet_atomic_batch_required");

    expect(sendTransactionAsync).not.toHaveBeenCalled();
  });
});
