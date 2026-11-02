import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { arbitrum } from "viem/chains";
import type { EvmWalletRuntime } from "@/wallet/runtime/evm/wallet-runtime";
import { buildEvmExecutionRuntime } from "./execution-runtime";

describe("buildEvmExecutionRuntime", () => {
  describe("bundle status recovery", () => {
    const signer = "0x2222222222222222222222222222222222222222";
    const callsId = "0xbundle";
    const status = (answer: unknown) => {
      const request = vi.fn().mockResolvedValue(answer);
      const getWalletClientFor = vi.fn().mockResolvedValue({ request });
      const runtime = buildEvmExecutionRuntime({
        activeConnector: { uid: "known-wallet" },
        activeEvmConnection: { address: signer },
        chainsById: { [arbitrum.id]: arbitrum },
        getWalletClientFor,
      } as unknown as EvmWalletRuntime);
      return {
        request,
        getWalletClientFor,
        check: () =>
          runtime.getPreparedEvmCallsStatus!({
            callsId,
            chainId: arbitrum.id,
            signer,
          }),
      };
    };
    it.each([100, 500, 600, 999])(
      "leaves status %i without receipts blocked",
      async (code) => {
        await expect(
          status({
            id: callsId,
            chainId: `0x${arbitrum.id.toString(16)}`,
            status: code,
          }).check(),
        ).resolves.toBeUndefined();
      },
    );
    it("reports only the matched terminal offchain failure without hashes", async () => {
      const { check, request, getWalletClientFor } = status({
        id: callsId,
        chainId: `0x${arbitrum.id.toString(16)}`,
        status: 400,
      });
      await expect(check()).resolves.toEqual({
        kind: "calls_not_submitted",
        calls_id: callsId,
      });
      expect(request).toHaveBeenCalledWith({
        method: "wallet_getCallsStatus",
        params: [callsId],
      });
      expect(getWalletClientFor).toHaveBeenCalledWith({
        connector: { uid: "known-wallet" },
      });
    });
    it.each([200, 500, 600])(
      "reports status %i receipt hashes for server verification",
      async (code) => {
        await expect(
          status({
            id: callsId,
            chainId: `0x${arbitrum.id.toString(16)}`,
            status: code,
            receipts: [{ transactionHash: "0xreceipt" }],
          }).check(),
        ).resolves.toEqual({ kind: "calls", transaction_ids: ["0xreceipt"] });
      },
    );
    it.each([
      { id: "wrong-id", chainId: "0xa4b1" },
      { id: callsId, chainId: "0x1" },
    ])("refuses a status for another bundle or chain", async (identity) => {
      await expect(
        status({ ...identity, status: 400 }).check(),
      ).rejects.toThrow("identity mismatch");
    });
  });

  describe("prepared commit bundles", () => {
    const address = "0x2222222222222222222222222222222222222222";
    const bundle = {
      kind: "wallet_calls" as const,
      chain_id: arbitrum.id,
      signer: address,
      calls: [
        {
          to: "0x1111111111111111111111111111111111111111",
          value: "5",
          data: "0x12",
          gas_limit: 50_000,
        },
        {
          to: "0x3333333333333333333333333333333333333333",
          value: "0",
          data: "0x34",
          gas_limit: 60_000,
        },
      ],
    };
    let connectors = 0;
    const runtimeWith = (
      sendCallsSyncAsync: ReturnType<typeof vi.fn>,
      atomic = "supported",
      name = "MetaMask",
    ) => {
      const activeConnector = {
        id: "wallet",
        name,
        uid: `uid-${++connectors}`,
      };
      const switchChainAsync = vi.fn().mockResolvedValue(undefined);
      const sendTransactionAsync = vi.fn().mockResolvedValue("0xsingle");
      const evm = {
        activeConnector,
        activeEvmConnection: { address, chainId: 1 },
        capabilities: {
          [`eip155:${arbitrum.id}`]: { atomic: { status: atomic } },
        },
        chainsById: { [arbitrum.id]: arbitrum },
        getWalletClientFor: vi.fn(),
        sendCallsSyncAsync,
        sendTransactionAsync,
        switchChainAsync,
      } as unknown as EvmWalletRuntime;
      return {
        runtime: buildEvmExecutionRuntime(evm),
        activeConnector,
        switchChainAsync,
        sendTransactionAsync,
      };
    };

    it("sends every call in one atomic bundle and answers its receipt hashes", async () => {
      const sendCallsSyncAsync = vi
        .fn()
        .mockResolvedValue({ receipts: [{ transactionHash: "0xbundle" }] });
      const {
        runtime,
        activeConnector,
        switchChainAsync,
        sendTransactionAsync,
      } = runtimeWith(sendCallsSyncAsync);
      const phases: string[] = [];

      expect(runtime.supportsAtomicEvmBatch?.(arbitrum.id)).toBe(true);
      // A chain the wallet didn't report is still offered a bundle.
      expect(runtime.supportsAtomicEvmBatch?.(1)).toBe(true);
      await expect(
        runtime.sendPreparedEvmCalls?.(bundle, (phase) => phases.push(phase)),
      ).resolves.toEqual(["0xbundle"]);

      expect(switchChainAsync).toHaveBeenCalledWith({
        chainId: arbitrum.id,
        connector: activeConnector,
      });
      expect(phases).toEqual(["switching_chain", "awaiting_wallet"]);
      expect(sendCallsSyncAsync).toHaveBeenCalledTimes(1);
      expect(sendCallsSyncAsync.mock.calls[0]![0]).toMatchObject({
        chainId: arbitrum.id,
        // The reviewed signer, not the connector's first account.
        account: bundle.signer,
        connector: activeConnector,
        calls: [
          { to: bundle.calls[0]!.to, value: BigInt(5), data: "0x12" },
          { to: bundle.calls[1]!.to, value: BigInt(0), data: "0x34" },
        ],
      });
      expect(sendTransactionAsync).not.toHaveBeenCalled();
    });

    it("does not offer bundles without atomic support, or to Rabby", () => {
      const { runtime } = runtimeWith(vi.fn(), "unsupported");
      expect(runtime.supportsAtomicEvmBatch?.(arbitrum.id)).toBe(false);
      const rabby = runtimeWith(vi.fn(), "supported", "Rabby Wallet").runtime;
      expect(rabby.supportsAtomicEvmBatch).toBeUndefined();
    });

    it("sends one by one after a clean refusal and stops offering bundles", async () => {
      const refusal = Object.assign(new Error("Atomicity not supported"), {
        code: 5760,
      });
      const { runtime, sendTransactionAsync } = runtimeWith(
        vi.fn().mockRejectedValue(refusal),
      );
      sendTransactionAsync
        .mockResolvedValueOnce("0xone")
        .mockResolvedValueOnce("0xtwo");
      const legs = { ...bundle, calls: [bundle.calls[0]!] };

      await expect(runtime.sendPreparedEvmCalls?.(legs)).resolves.toEqual([
        "0xone",
      ]);
      expect(sendTransactionAsync).toHaveBeenCalledTimes(1);
      expect(runtime.supportsAtomicEvmBatch?.(arbitrum.id)).toBe(false);
      expect(runtime.supportsAtomicEvmBatch?.(1)).toBe(true);
    });

    it("keeps the provider rejection code when the user declines the bundle", async () => {
      const declined = Object.assign(new Error("User rejected"), {
        code: 4001,
      });
      const { runtime, sendTransactionAsync } = runtimeWith(
        vi.fn().mockRejectedValue(declined),
      );

      const error = await runtime
        .sendPreparedEvmCalls?.(bundle)
        .catch((caught: unknown) => caught);
      expect((error as Error).cause).toBe(declined);
      expect(sendTransactionAsync).not.toHaveBeenCalled();
    });

    it("answers the hashes of a bundle that landed and reverted", async () => {
      const failed = Object.assign(new Error("Call bundle failed"), {
        name: "BundleFailedError",
        result: { receipts: [{ transactionHash: "0xreverted" }] },
      });
      const { runtime } = runtimeWith(vi.fn().mockRejectedValue(failed));
      await expect(runtime.sendPreparedEvmCalls?.(bundle)).resolves.toEqual([
        "0xreverted",
      ]);
    });
  });

  it("keeps prepared-send preflight local", async () => {
    const address = "0x2222222222222222222222222222222222222222";
    const switchChainAsync = vi.fn().mockResolvedValue(undefined);
    const getWalletClientFor = vi.fn();
    const activeConnector = {
      id: "wallet",
      getAccounts: vi.fn().mockResolvedValue([address]),
      getChainId: vi.fn().mockResolvedValue(arbitrum.id),
    };
    const evm = {
      activeConnector,
      activeEvmConnection: { address, chainId: 1 },
      chainsById: { [arbitrum.id]: arbitrum },
      getWalletClientFor,
      sendTransactionAsync: vi.fn().mockResolvedValue("0xhash"),
      switchChainAsync,
    } as unknown as EvmWalletRuntime;
    const payload = {
      kind: "evm_transaction" as const,
      chain_id: arbitrum.id,
      signer: address,
      nonce: 7,
      transaction: {
        to: "0x1111111111111111111111111111111111111111",
        value: "0",
        data: "0x",
        gas_limit: 21_000,
        max_fee_per_gas: "2",
        max_priority_fee_per_gas: "1",
      },
    };

    await expect(
      buildEvmExecutionRuntime(evm).preparePreparedEvmTransaction?.(payload),
    ).resolves.toBeUndefined();
    expect(activeConnector.getAccounts).not.toHaveBeenCalled();
    expect(activeConnector.getChainId).not.toHaveBeenCalled();
    expect(switchChainAsync).not.toHaveBeenCalled();
    expect(getWalletClientFor).not.toHaveBeenCalled();

    evm.activeEvmConnection = {
      address: "0x3333333333333333333333333333333333333333",
      chainId: 1,
    } as typeof evm.activeEvmConnection;
    await expect(
      buildEvmExecutionRuntime(evm).preparePreparedEvmTransaction?.(payload),
    ).rejects.toThrow("Expected signing wallet is not active");
  });

  it("switches the pinned connector only when invoking the wallet", async () => {
    const address = "0x2222222222222222222222222222222222222222";
    const activeConnector = {
      id: "wallet",
      getAccounts: vi.fn().mockResolvedValue([address]),
      getChainId: vi.fn().mockResolvedValue(1),
    };
    const switchChainAsync = vi.fn().mockResolvedValue(undefined);
    const sendTransactionAsync = vi.fn().mockResolvedValue("0xhash");
    const evm = {
      activeConnector,
      activeEvmConnection: { address, chainId: 1 },
      chainsById: { [arbitrum.id]: arbitrum },
      getWalletClientFor: vi.fn(),
      sendTransactionAsync,
      switchChainAsync,
    } as unknown as EvmWalletRuntime;

    const runtime = buildEvmExecutionRuntime(evm);
    const payload = {
      kind: "evm_transaction",
      chain_id: arbitrum.id,
      signer: address,
      nonce: 7,
      transaction: {
        to: "0x1111111111111111111111111111111111111111",
        value: "0",
        data: "0x",
        gas_limit: 21_000,
        max_fee_per_gas: "2",
        max_priority_fee_per_gas: "1",
      },
    } as const;
    await expect(
      runtime.preparePreparedEvmTransaction?.(payload),
    ).resolves.toBeUndefined();
    expect(switchChainAsync).not.toHaveBeenCalled();
    const phases: string[] = [];
    await runtime.sendPreparedEvmTransaction?.(payload, (phase) =>
      phases.push(phase),
    );
    expect(phases).toEqual(["switching_chain", "awaiting_wallet"]);
    expect(switchChainAsync.mock.invocationCallOrder[0]).toBeLessThan(
      sendTransactionAsync.mock.invocationCallOrder[0],
    );
    expect(switchChainAsync).toHaveBeenCalledWith({
      chainId: arbitrum.id,
      connector: activeConnector,
    });
  });

  it("reports a stale selected account before acquiring a wallet attempt", async () => {
    const address = "0x2222222222222222222222222222222222222222";
    const evm = {
      activeConnector: {
        id: "wallet",
        getAccounts: vi.fn().mockResolvedValue([]),
        getChainId: vi.fn().mockResolvedValue(arbitrum.id),
      },
      activeEvmConnection: {
        address: "0x3333333333333333333333333333333333333333",
        chainId: arbitrum.id,
      },
      chainsById: { [arbitrum.id]: arbitrum },
      getWalletClientFor: vi.fn(),
      sendTransactionAsync: vi.fn(),
    } as unknown as EvmWalletRuntime;

    await expect(
      buildEvmExecutionRuntime(evm).preparePreparedEvmTransaction?.({
        kind: "evm_transaction",
        chain_id: arbitrum.id,
        signer: address,
        nonce: 7,
        transaction: {
          to: "0x1111111111111111111111111111111111111111",
          value: "0",
          data: "0x",
          gas_limit: 21_000,
          max_fee_per_gas: "2",
          max_priority_fee_per_gas: "1",
        },
      }),
    ).rejects.toThrow("Expected signing wallet is not active");
  });

  it("sends an external prepared transaction through the pinned connector", async () => {
    const address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const sendTransactionAsync = vi.fn().mockResolvedValue("0xhash");
    const getWalletClientFor = vi.fn();
    const activeConnector = {
      id: "wallet",
      getAccounts: vi.fn().mockResolvedValue([address]),
      getChainId: vi.fn().mockResolvedValue(arbitrum.id),
    };
    const evm = {
      activeConnector,
      activeEvmConnection: { address, chainId: arbitrum.id },
      chainsById: { [arbitrum.id]: arbitrum },
      getWalletClientFor,
      sendTransactionAsync,
    } as unknown as EvmWalletRuntime;
    const runtime = buildEvmExecutionRuntime(evm);
    const payload = {
      kind: "evm_transaction" as const,
      chain_id: arbitrum.id,
      signer: address,
      nonce: 7,
      transaction: {
        to: "0x1111111111111111111111111111111111111111",
        value: "9",
        data: "0x1234",
        gas_limit: 25_000,
        max_fee_per_gas: "30",
        max_priority_fee_per_gas: "2",
      },
    };

    await expect(
      runtime.preparePreparedEvmTransaction?.(payload),
    ).resolves.toBeUndefined();
    evm.activeConnector = {
      id: "other-wallet",
      getAccounts: vi.fn(),
      getChainId: vi.fn(),
    } as unknown as typeof evm.activeConnector;
    await expect(runtime.sendPreparedEvmTransaction?.(payload)).resolves.toBe(
      "0xhash",
    );
    expect(getWalletClientFor).not.toHaveBeenCalled();
    expect(sendTransactionAsync).toHaveBeenCalledWith({
      account: address,
      chainId: arbitrum.id,
      connector: activeConnector,
      to: "0x1111111111111111111111111111111111111111",
      data: "0x1234",
      value: BigInt(9),
    });
    expect(sendTransactionAsync.mock.calls[0]?.[0]).not.toHaveProperty("nonce");
  });

  it("passes byte-equivalent targets to the browser provider and rejects malformed targets", async () => {
    const address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const mixedCase = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
    const sendTransactionAsync = vi.fn().mockResolvedValue("0xhash");
    const evm = {
      activeConnector: { id: "wallet" },
      activeEvmConnection: { address, chainId: arbitrum.id },
      chainsById: { [arbitrum.id]: arbitrum },
      getWalletClientFor: vi.fn(),
      sendTransactionAsync,
    } as unknown as EvmWalletRuntime;
    const runtime = buildEvmExecutionRuntime(evm);
    const send = runtime.sendPreparedEvmTransaction!;
    const payload = {
      kind: "evm_transaction" as const,
      chain_id: arbitrum.id,
      signer: address,
      nonce: 7,
      transaction: {
        to: mixedCase,
        value: "0",
        data: "0x",
        gas_limit: 21_000,
        max_fee_per_gas: "2",
        max_priority_fee_per_gas: "1",
      },
    };
    await expect(
      runtime.preparePreparedEvmTransaction?.(payload),
    ).resolves.toBeUndefined();
    await send(payload);
    expect(sendTransactionAsync.mock.calls[0]?.[0].to).toBe(
      getAddress(mixedCase.toLowerCase()),
    );
    expect(payload.transaction.to).toBe(mixedCase);

    for (const invalid of ["0x1234", `0x${"g".repeat(40)}`]) {
      const malformed = {
        ...payload,
        transaction: { ...payload.transaction, to: invalid },
      };
      await expect(
        runtime.preparePreparedEvmTransaction?.(malformed),
      ).rejects.toThrow();
      await expect(send(malformed)).rejects.toThrow();
    }
    expect(sendTransactionAsync).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale selected account before sending", async () => {
    const address = "0x2222222222222222222222222222222222222222";
    const sendTransactionAsync = vi.fn();
    const evm = {
      activeConnector: { id: "wallet" },
      activeEvmConnection: {
        address: "0x3333333333333333333333333333333333333333",
        chainId: arbitrum.id,
      },
      chainsById: { [arbitrum.id]: arbitrum },
      getWalletClientFor: vi.fn(),
      sendTransactionAsync,
    } as unknown as EvmWalletRuntime;

    await expect(
      buildEvmExecutionRuntime(evm).sendPreparedEvmTransaction?.({
        kind: "evm_transaction",
        chain_id: arbitrum.id,
        signer: address,
        nonce: 7,
        transaction: {
          to: "0x1111111111111111111111111111111111111111",
          value: "0",
          data: "0x",
          gas_limit: 21_000,
          max_fee_per_gas: "2",
          max_priority_fee_per_gas: "1",
        },
      }),
    ).rejects.toThrow("Expected signing wallet is not active");
    expect(sendTransactionAsync).not.toHaveBeenCalled();
  });

  it.each(["switch", "send"] as const)(
    "preserves an explicit wallet rejection during %s for commit recovery",
    async (operation) => {
      const address = "0x2222222222222222222222222222222222222222";
      const rejection = Object.assign(new Error("User rejected the request"), {
        code: 4001,
      });
      const sendTransactionAsync = vi.fn().mockResolvedValue("0xhash");
      const switchChainAsync = vi.fn().mockResolvedValue(undefined);
      (operation === "switch"
        ? switchChainAsync
        : sendTransactionAsync
      ).mockRejectedValue(rejection);
      const evm = {
        activeConnector: { id: "wallet" },
        activeEvmConnection: { address, chainId: 1 },
        chainsById: { [arbitrum.id]: arbitrum },
        sendTransactionAsync,
        switchChainAsync,
      } as unknown as EvmWalletRuntime;

      await expect(
        buildEvmExecutionRuntime(evm).sendPreparedEvmTransaction?.({
          kind: "evm_transaction",
          chain_id: arbitrum.id,
          signer: address,
          nonce: 7,
          transaction: {
            to: "0x1111111111111111111111111111111111111111",
            value: "0",
            data: "0x",
            gas_limit: 21_000,
            max_fee_per_gas: "2",
            max_priority_fee_per_gas: "1",
          },
        }),
      ).rejects.toMatchObject({ cause: rejection });
      expect(sendTransactionAsync).toHaveBeenCalledTimes(
        operation === "switch" ? 0 : 1,
      );
    },
  );

  it("keeps managed local-account prepared sends on their signing client", async () => {
    const address = "0x2222222222222222222222222222222222222222";
    const localAccount = { address, type: "local" as const };
    const sendTransaction = vi.fn().mockResolvedValue("0xhash");
    const sendTransactionAsync = vi.fn().mockResolvedValue("0xhash");
    const evm = {
      activeEvmConnection: { chainId: arbitrum.id },
      chainsById: { [arbitrum.id]: arbitrum },
      getWalletClientFor: vi.fn(),
      sendTransactionAsync,
      walletClient: {
        account: localAccount,
        getChainId: vi.fn().mockResolvedValue(arbitrum.id),
        sendTransaction,
      },
    } as unknown as EvmWalletRuntime;

    await expect(
      buildEvmExecutionRuntime(evm).sendPreparedEvmTransaction?.({
        kind: "evm_transaction",
        chain_id: arbitrum.id,
        signer: address,
        nonce: 7,
        transaction: {
          to: "0x1111111111111111111111111111111111111111",
          value: "0",
          data: "0x",
          gas_limit: 21_000,
          max_fee_per_gas: "2",
          max_priority_fee_per_gas: "1",
        },
      }),
    ).resolves.toBe("0xhash");
    expect(sendTransaction).toHaveBeenCalledWith({
      account: localAccount,
      chain: arbitrum,
      type: "eip1559",
      to: "0x1111111111111111111111111111111111111111",
      data: "0x",
      value: BigInt(0),
      gas: BigInt(21_000),
      maxFeePerGas: BigInt(2),
      maxPriorityFeePerGas: BigInt(1),
    });
    expect(sendTransaction.mock.calls[0]?.[0]).not.toHaveProperty("nonce");
    expect(sendTransactionAsync).not.toHaveBeenCalled();
  });

  it("does not advertise prepared sends for embedded providers without a wallet client", () => {
    const evm = {
      chainsById: {},
      getWalletClientFor: vi.fn(),
      sendTransactionAsync: vi.fn(),
    } as unknown as EvmWalletRuntime;
    const runtime = buildEvmExecutionRuntime(evm);
    expect(runtime.preparePreparedEvmTransaction).toBeUndefined();
    expect(runtime.sendPreparedEvmTransaction).toBeUndefined();
  });

  it("pins typed-data signing to the selected address, not the connector's first account", async () => {
    const address = "0x2222222222222222222222222222222222222222";
    const signTypedDataAsync = vi.fn().mockResolvedValue("0xsignature");
    const evm = {
      activeConnector: { id: "para" },
      activeEvmConnection: { address },
      signTypedDataAsync,
      chainsById: {},
    } as unknown as EvmWalletRuntime;
    await buildEvmExecutionRuntime(evm).signTypedData?.({
      typed_data: { primaryType: "Permit" },
    });
    expect(signTypedDataAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        account: address,
        connector: evm.activeConnector,
      }),
    );
  });

  it("does not switch again when the caller already selected the transaction chain", async () => {
    const sendTransactionAsync = vi.fn().mockResolvedValue("0x111");
    const switchChainAsync = vi.fn();
    const waitForTransactionReceipt = vi
      .fn()
      .mockResolvedValue({ status: "success" });
    const evm = {
      activeConnector: { id: "wallet" },
      activeEvmConnection: { chainId: 8453 },
      chainsById: { [arbitrum.id]: arbitrum },
      getWalletClientFor: vi.fn(),
      sendCallsSyncAsync: undefined,
      sendTransactionAsync,
      shouldUseExternalSigner: false,
      signMessageAsync: undefined,
      signTypedDataAsync: undefined,
      switchChainAsync,
      walletClient: undefined,
    } as unknown as EvmWalletRuntime;

    const runtime = buildEvmExecutionRuntime(evm, {
      waitForTransactionReceipt,
    });
    await runtime.sendTransaction?.(
      {
        to: "0x1111111111111111111111111111111111111111",
        value: "1",
        data: "0x",
        chainId: arbitrum.id,
      },
      { chainIdAlreadySelected: arbitrum.id },
    );

    expect(switchChainAsync).not.toHaveBeenCalled();
    expect(sendTransactionAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: arbitrum.id,
        connector: evm.activeConnector,
      }),
    );
  });

  it("routes plain-message signing through the selected account signer", async () => {
    const signMessageForAccount = vi.fn().mockResolvedValue("0xsignature");
    const signMessageAsync = vi.fn();
    const evm = {
      activeAccount: { id: "para-account" },
      activeEvmConnection: { chainId: 1 },
      chainsById: {},
      getWalletClientFor: vi.fn(),
      sendCallsSyncAsync: undefined,
      sendTransactionAsync: undefined,
      shouldUseExternalSigner: false,
      signMessageAsync,
      signMessageForAccount,
      signTypedDataAsync: undefined,
      switchChainAsync: undefined,
      walletClient: undefined,
    } as unknown as EvmWalletRuntime;

    const runtime = buildEvmExecutionRuntime(evm);
    await expect(
      runtime.signMessage?.({
        non_typed_data: "AOMI_E2E_SAFE_SIGN",
        description: "Sign a harmless message",
      }),
    ).resolves.toEqual({ signature: "0xsignature" });

    expect(signMessageForAccount).toHaveBeenCalledWith({
      accountId: "para-account",
      message: "AOMI_E2E_SAFE_SIGN",
      chainId: 1,
    });
    expect(signMessageAsync).not.toHaveBeenCalled();
  });
});
