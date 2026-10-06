import { describe, expect, it, vi } from "vitest";
import { mainnet } from "viem/chains";

import { executeWalletCalls } from "../../src/aa";

const CALL_LIST = [
  {
    to: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    value: 1n,
    data: "0x" as `0x${string}`,
    chainId: 1,
  },
  {
    to: "0x2222222222222222222222222222222222222222" as `0x${string}`,
    value: 2n,
    data: "0x" as `0x${string}`,
    chainId: 1,
  },
];

describe("executeWalletCalls EOA capability handling", () => {
  it("uses direct EOA signing for a single call even when atomic sendCalls is supported", async () => {
    const sendCallsSyncAsync = vi.fn().mockResolvedValue({
      receipts: [{ transactionHash: "0xabc" }],
    });
    const sendTransactionAsync = vi.fn().mockResolvedValue("0xsingle");
    const singleCall = [CALL_LIST[0]];

    const result = await executeWalletCalls({
      callList: singleCall,
      currentChainId: 1,
      capabilities: {
        "eip155:1": { atomic: { status: "ready" } },
      },
      localPrivateKey: null,
      sendCallsSyncAsync,
      sendTransactionAsync,
      switchChainAsync: vi.fn(),
      chainsById: { [mainnet.id]: mainnet },
      getPreferredRpcUrl: () => "https://example-rpc.invalid",
    });

    expect(sendCallsSyncAsync).not.toHaveBeenCalled();
    expect(sendTransactionAsync).toHaveBeenCalledWith({
      chainId: 1,
      to: singleCall[0].to,
      value: singleCall[0].value,
      data: undefined,
    });
    expect(result).toMatchObject({
      txHash: "0xsingle",
      txHashes: ["0xsingle"],
      executionKind: "eoa",
      batched: false,
      sponsored: false,
    });
  });

  it("keeps optional sponsorship from forcing single-call sendCalls", async () => {
    const sendCallsSyncAsync = vi.fn().mockResolvedValue({
      receipts: [{ transactionHash: "0xabc" }],
    });
    const sendTransactionAsync = vi.fn().mockResolvedValue("0xsingle");
    const singleCall = [CALL_LIST[0]];

    const result = await executeWalletCalls({
      callList: singleCall,
      currentChainId: 1,
      capabilities: {
        "eip155:1": {
          atomic: { status: "ready" },
          paymasterService: { supported: true },
        },
      },
      localPrivateKey: null,
      nativeWalletExecution: {
        executionKind: "base_account_4337",
        sponsorship: {
          mode: "optional",
          paymasterServiceUrl: "https://paymaster.example.test",
        },
      },
      sendCallsSyncAsync,
      sendTransactionAsync,
      switchChainAsync: vi.fn(),
      chainsById: { [mainnet.id]: mainnet },
      getPreferredRpcUrl: () => "https://example-rpc.invalid",
    });

    expect(sendCallsSyncAsync).not.toHaveBeenCalled();
    expect(sendTransactionAsync).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      txHash: "0xsingle",
      executionKind: "eoa",
      sponsored: false,
    });
  });

  it("uses required paymasterService sendCalls for a single wallet-native call", async () => {
    const sendCallsSyncAsync = vi.fn().mockResolvedValue({
      receipts: [{ transactionHash: "0xabc" }],
      status: "success",
    });
    const sendTransactionAsync = vi.fn();
    const singleCall = [CALL_LIST[0]];

    const result = await executeWalletCalls({
      callList: singleCall,
      currentChainId: 1,
      capabilities: {
        "eip155:1": {
          paymasterService: { supported: true },
        },
      },
      localPrivateKey: null,
      nativeWalletExecution: {
        executionKind: "base_account_4337",
        sendCallsTimeoutMs: 45_000,
        sendCallsVersion: "1.0",
        sponsorship: {
          mode: "required",
          paymasterServiceUrl: "https://paymaster.example.test",
          paymasterServiceContext: {
            policyId: "test-policy",
            erc20: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            paymasterAddress: "0x2faeb0760d4230ef2ac21496bb4f0b47d634fd4c",
          } as never,
        },
      },
      sendCallsSyncAsync,
      sendTransactionAsync,
      switchChainAsync: vi.fn(),
      chainsById: { [mainnet.id]: mainnet },
      getPreferredRpcUrl: () => "https://example-rpc.invalid",
    });

    expect(sendCallsSyncAsync).toHaveBeenCalledWith({
      chainId: 1,
      calls: [
        {
          to: singleCall[0].to,
          value: singleCall[0].value,
          data: undefined,
        },
      ],
      capabilities: {
        paymasterService: {
          url: "https://paymaster.example.test",
          context: {
            policyId: "test-policy",
          },
        },
      },
      forceAtomic: false,
      status: expect.any(Function),
      throwOnFailure: true,
      timeout: 45_000,
      version: "1.0",
    });
    expect(sendTransactionAsync).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      txHash: "0xabc",
      txHashes: ["0xabc"],
      executionKind: "base_account_4337",
      batched: false,
      sponsored: true,
    });
  });

  it("fails closed when required sponsorship has no paymaster URL", async () => {
    const sendCallsSyncAsync = vi.fn();
    const sendTransactionAsync = vi.fn();

    await expect(
      executeWalletCalls({
        callList: [CALL_LIST[0]],
        currentChainId: 1,
        capabilities: {
          "eip155:1": {
            paymasterService: { supported: true },
          },
        },
        localPrivateKey: null,
        nativeWalletExecution: {
          executionKind: "base_account_4337",
          sponsorship: {
            mode: "required",
          },
        },
        sendCallsSyncAsync,
        sendTransactionAsync,
        switchChainAsync: vi.fn(),
        chainsById: { [mainnet.id]: mainnet },
        getPreferredRpcUrl: () => "https://example-rpc.invalid",
      }),
    ).rejects.toThrow("wallet_paymaster_service_url_required");

    expect(sendCallsSyncAsync).not.toHaveBeenCalled();
    expect(sendTransactionAsync).not.toHaveBeenCalled();
  });

  it("passes an explicit empty paymasterService context for required sponsorship", async () => {
    const sendCallsSyncAsync = vi.fn().mockResolvedValue({
      receipts: [{ transactionHash: "0xabc" }],
      status: "success",
    });

    await executeWalletCalls({
      callList: [CALL_LIST[0]],
      currentChainId: 1,
      capabilities: {
        "eip155:1": {
          paymasterService: { supported: true },
        },
      },
      localPrivateKey: null,
      nativeWalletExecution: {
        executionKind: "base_account_4337",
        sponsorship: {
          mode: "required",
          paymasterServiceUrl: "https://paymaster.example.test",
        },
      },
      sendCallsSyncAsync,
      sendTransactionAsync: vi.fn(),
      switchChainAsync: vi.fn(),
      chainsById: { [mainnet.id]: mainnet },
      getPreferredRpcUrl: () => "https://example-rpc.invalid",
    });

    expect(sendCallsSyncAsync).toHaveBeenCalledWith({
      chainId: 1,
      calls: expect.any(Array),
      capabilities: {
        paymasterService: {
          url: "https://paymaster.example.test",
          context: {},
        },
      },
      forceAtomic: false,
      status: expect.any(Function),
      throwOnFailure: true,
      timeout: undefined,
      version: undefined,
    });
  });

  it("fails closed when required sponsorship is unsupported by wallet capabilities", async () => {
    const sendCallsSyncAsync = vi.fn();
    const sendTransactionAsync = vi.fn();

    await expect(
      executeWalletCalls({
        callList: [CALL_LIST[0]],
        currentChainId: 1,
        capabilities: {
          "eip155:1": {},
        },
        localPrivateKey: null,
        nativeWalletExecution: {
          executionKind: "base_account_4337",
          sponsorship: {
            mode: "required",
            paymasterServiceUrl: "https://paymaster.example.test",
          },
        },
        sendCallsSyncAsync,
        sendTransactionAsync,
        switchChainAsync: vi.fn(),
        chainsById: { [mainnet.id]: mainnet },
        getPreferredRpcUrl: () => "https://example-rpc.invalid",
      }),
    ).rejects.toThrow("wallet_paymaster_service_unsupported");

    expect(sendCallsSyncAsync).not.toHaveBeenCalled();
    expect(sendTransactionAsync).not.toHaveBeenCalled();
  });

  it("requests atomic as optional for sendCalls", async () => {
    const sendCallsSyncAsync = vi.fn().mockResolvedValue({
      receipts: [{ transactionHash: "0xabc" }, { transactionHash: "0xdef" }],
    });
    const sendTransactionAsync = vi.fn();

    const result = await executeWalletCalls({
      callList: CALL_LIST,
      currentChainId: 1,
      capabilities: {
        "eip155:1": { atomic: { status: "ready" } },
      },
      localPrivateKey: null,
      sendCallsSyncAsync,
      sendTransactionAsync,
      switchChainAsync: vi.fn(),
      chainsById: { [mainnet.id]: mainnet },
      getPreferredRpcUrl: () => "https://example-rpc.invalid",
    });

    expect(sendCallsSyncAsync).toHaveBeenCalledWith({
      chainId: 1,
      calls: [
        {
          to: CALL_LIST[0].to,
          value: CALL_LIST[0].value,
          data: undefined,
        },
        {
          to: CALL_LIST[1].to,
          value: CALL_LIST[1].value,
          data: undefined,
        },
      ],
      capabilities: {
        atomic: { optional: true },
      },
      forceAtomic: false,
      status: expect.any(Function),
      throwOnFailure: true,
      timeout: undefined,
      version: undefined,
    });
    expect(sendTransactionAsync).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      txHash: "0xdef",
      txHashes: ["0xabc", "0xdef"],
      executionKind: "eoa",
      batched: true,
      sponsored: false,
    });
  });

  it("falls back to sequential sendTransaction when atomic capability is rejected", async () => {
    const sendCallsSyncAsync = vi
      .fn()
      .mockRejectedValue(
        new Error("Unsupported non-optional capabilities: atomic"),
      );
    const sendTransactionAsync = vi
      .fn()
      .mockResolvedValueOnce("0x111")
      .mockResolvedValueOnce("0x222");

    const result = await executeWalletCalls({
      callList: CALL_LIST,
      currentChainId: 1,
      capabilities: {
        "eip155:1": { atomic: { status: "ready" } },
      },
      localPrivateKey: null,
      sendCallsSyncAsync,
      sendTransactionAsync,
      switchChainAsync: vi.fn(),
      chainsById: { [mainnet.id]: mainnet },
      getPreferredRpcUrl: () => "https://example-rpc.invalid",
    });

    expect(sendCallsSyncAsync).toHaveBeenCalledTimes(1);
    expect(sendTransactionAsync).toHaveBeenCalledTimes(2);
    expect(sendTransactionAsync).toHaveBeenNthCalledWith(1, {
      chainId: 1,
      to: CALL_LIST[0].to,
      value: CALL_LIST[0].value,
      data: undefined,
    });
    expect(sendTransactionAsync).toHaveBeenNthCalledWith(2, {
      chainId: 1,
      to: CALL_LIST[1].to,
      value: CALL_LIST[1].value,
      data: undefined,
    });
    expect(result).toMatchObject({
      txHash: "0x222",
      txHashes: ["0x111", "0x222"],
      executionKind: "eoa",
      batched: true,
      sponsored: false,
    });
  });

  it("reports eoa when wallet-native execution falls back to sequential sends", async () => {
    const sendCallsSyncAsync = vi
      .fn()
      .mockRejectedValue(
        new Error("Unsupported non-optional capabilities: atomic"),
      );
    const sendTransactionAsync = vi
      .fn()
      .mockResolvedValueOnce("0x111")
      .mockResolvedValueOnce("0x222");

    const result = await executeWalletCalls({
      callList: CALL_LIST,
      currentChainId: 1,
      capabilities: {
        "eip155:1": { atomic: { status: "ready" } },
      },
      localPrivateKey: null,
      nativeWalletExecution: {
        executionKind: "base_account_4337",
      },
      sendCallsSyncAsync,
      sendTransactionAsync,
      switchChainAsync: vi.fn(),
      chainsById: { [mainnet.id]: mainnet },
      getPreferredRpcUrl: () => "https://example-rpc.invalid",
    });

    expect(sendCallsSyncAsync).toHaveBeenCalledTimes(1);
    expect(sendTransactionAsync).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      txHash: "0x222",
      txHashes: ["0x111", "0x222"],
      executionKind: "eoa",
      batched: true,
      sponsored: false,
    });
  });

  it("falls back to sequential sendTransaction when optional paymaster sendCalls fails", async () => {
    const sendCallsSyncAsync = vi
      .fn()
      .mockRejectedValue(new Error("Paymaster request failed with 500"));
    const sendTransactionAsync = vi
      .fn()
      .mockResolvedValueOnce("0x111")
      .mockResolvedValueOnce("0x222");

    const result = await executeWalletCalls({
      callList: CALL_LIST,
      currentChainId: 1,
      capabilities: {
        "eip155:1": {
          atomic: { status: "ready" },
          paymasterService: { supported: true },
        },
      },
      localPrivateKey: null,
      nativeWalletExecution: {
        executionKind: "base_account_4337",
        sponsorship: {
          mode: "optional",
          paymasterServiceUrl: "https://paymaster.example.test",
        },
      },
      sendCallsSyncAsync,
      sendTransactionAsync,
      switchChainAsync: vi.fn(),
      chainsById: { [mainnet.id]: mainnet },
      getPreferredRpcUrl: () => "https://example-rpc.invalid",
    });

    expect(sendCallsSyncAsync).toHaveBeenCalledTimes(1);
    expect(sendTransactionAsync).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      txHash: "0x222",
      txHashes: ["0x111", "0x222"],
      executionKind: "eoa",
      batched: true,
      sponsored: false,
    });
  });

  it("requires atomic sendCalls and blocks sequential fallback when requested", async () => {
    const sendCallsSyncAsync = vi.fn().mockResolvedValue({
      receipts: [{ transactionHash: "0xabc" }, { transactionHash: "0xdef" }],
      status: "success",
    });
    const sendTransactionAsync = vi.fn();

    const result = await executeWalletCalls({
      callList: CALL_LIST,
      currentChainId: 1,
      capabilities: {
        "eip155:1": { atomic: { status: "supported" } },
      },
      localPrivateKey: null,
      nativeWalletExecution: {
        requiresAtomicForBatch: true,
      },
      sendCallsSyncAsync,
      sendTransactionAsync,
      switchChainAsync: vi.fn(),
      chainsById: { [mainnet.id]: mainnet },
      getPreferredRpcUrl: () => "https://example-rpc.invalid",
    });

    expect(sendCallsSyncAsync).toHaveBeenCalledWith({
      chainId: 1,
      calls: [
        {
          to: CALL_LIST[0].to,
          value: CALL_LIST[0].value,
          data: undefined,
        },
        {
          to: CALL_LIST[1].to,
          value: CALL_LIST[1].value,
          data: undefined,
        },
      ],
      capabilities: {
        atomic: { required: true },
      },
      forceAtomic: true,
      status: expect.any(Function),
      throwOnFailure: true,
      timeout: undefined,
      version: undefined,
    });
    expect(sendTransactionAsync).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      txHash: "0xdef",
      txHashes: ["0xabc", "0xdef"],
      executionKind: "eoa",
      batched: true,
      sponsored: false,
    });
  });

  it("does not sequentially send when an atomic-required batch is unsupported", async () => {
    const sendCallsSyncAsync = vi
      .fn()
      .mockRejectedValue(
        new Error("Unsupported non-optional capabilities: atomic"),
      );
    const sendTransactionAsync = vi.fn();

    await expect(
      executeWalletCalls({
        callList: CALL_LIST,
        currentChainId: 1,
        capabilities: {
          "eip155:1": { atomic: { status: "ready" } },
        },
        localPrivateKey: null,
        nativeWalletExecution: {
          requiresAtomicForBatch: true,
        },
        sendCallsSyncAsync,
        sendTransactionAsync,
        switchChainAsync: vi.fn(),
        chainsById: { [mainnet.id]: mainnet },
        getPreferredRpcUrl: () => "https://example-rpc.invalid",
      }),
    ).rejects.toThrow("wallet_atomic_batch_required");

    expect(sendCallsSyncAsync).toHaveBeenCalledTimes(1);
    expect(sendTransactionAsync).not.toHaveBeenCalled();
  });

  it("passes optional paymasterService for wallet-native smart wallet execution", async () => {
    const sendCallsSyncAsync = vi.fn().mockResolvedValue({
      receipts: [{ transactionHash: "0xabc" }, { transactionHash: "0xdef" }],
      status: "success",
    });

    const result = await executeWalletCalls({
      callList: CALL_LIST,
      currentChainId: 1,
      capabilities: {
        "eip155:1": {
          atomic: { status: "ready" },
          paymasterService: { supported: true },
        },
      },
      localPrivateKey: null,
      nativeWalletExecution: {
        executionKind: "base_account_4337",
        requiresAtomicForBatch: true,
        sendCallsTimeoutMs: 45_000,
        sendCallsVersion: "1.0",
        sponsorship: {
          mode: "optional",
          paymasterServiceUrl: "https://paymaster.example.test",
        },
      },
      sendCallsSyncAsync,
      sendTransactionAsync: vi.fn(),
      switchChainAsync: vi.fn(),
      chainsById: { [mainnet.id]: mainnet },
      getPreferredRpcUrl: () => "https://example-rpc.invalid",
    });

    expect(sendCallsSyncAsync).toHaveBeenCalledWith({
      chainId: 1,
      calls: expect.any(Array),
      capabilities: {
        atomic: { required: true },
        paymasterService: {
          url: "https://paymaster.example.test",
          optional: true,
        },
      },
      forceAtomic: true,
      status: expect.any(Function),
      throwOnFailure: true,
      timeout: 45_000,
      version: "1.0",
    });
    // `sponsored` is intentionally `undefined` for optional-sponsorship:
    // the wallet may silently fall back to user-paid while sendCalls still
    // resolves, and we cannot verify post-hoc without decoding the userOp
    // logs. `required` mode would report `true` because the protocol fails
    // the tx if the paymaster rejects.
    expect(result).toMatchObject({
      txHash: "0xdef",
      executionKind: "base_account_4337",
    });
    expect(result.sponsored).toBeUndefined();
  });

  it("does not forward ERC20 payment context for wallet-native sponsorship", async () => {
    const sendCallsSyncAsync = vi.fn().mockResolvedValue({
      receipts: [{ transactionHash: "0xabc" }, { transactionHash: "0xdef" }],
      status: "success",
    });

    await executeWalletCalls({
      callList: CALL_LIST,
      currentChainId: 1,
      capabilities: {
        "eip155:1": {
          atomic: { status: "ready" },
          paymasterService: { supported: true },
        },
      },
      localPrivateKey: null,
      nativeWalletExecution: {
        executionKind: "base_account_4337",
        requiresAtomicForBatch: true,
        sponsorship: {
          mode: "optional",
          paymasterServiceUrl: "https://paymaster.example.test",
          paymasterServiceContext: {
            erc20: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            paymasterAddress: "0x2faeb0760d4230ef2ac21496bb4f0b47d634fd4c",
          } as never,
        },
      },
      sendCallsSyncAsync,
      sendTransactionAsync: vi.fn(),
      switchChainAsync: vi.fn(),
      chainsById: { [mainnet.id]: mainnet },
      getPreferredRpcUrl: () => "https://example-rpc.invalid",
    });

    expect(sendCallsSyncAsync).toHaveBeenCalledWith({
      chainId: 1,
      calls: expect.any(Array),
      capabilities: {
        atomic: { required: true },
        paymasterService: {
          url: "https://paymaster.example.test",
          optional: true,
        },
      },
      forceAtomic: true,
      status: expect.any(Function),
      throwOnFailure: true,
      timeout: undefined,
      version: undefined,
    });
  });
});
