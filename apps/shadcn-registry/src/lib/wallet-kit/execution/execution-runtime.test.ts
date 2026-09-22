import { describe, expect, it, vi } from "vitest";
import { arbitrum } from "viem/chains";
import type { EvmWalletRuntime } from "../runtime/evm/wallet-runtime";
import { buildEvmExecutionRuntime } from "./execution-runtime";

describe("buildEvmExecutionRuntime", () => {
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
    const evm = {
      activeConnector,
      activeEvmConnection: { address, chainId: 1 },
      chainsById: { [arbitrum.id]: arbitrum },
      getWalletClientFor: vi.fn(),
      sendTransactionAsync: vi.fn().mockResolvedValue("0xhash"),
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
    await runtime.sendPreparedEvmTransaction?.(payload);
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
      nonce: 7,
      to: "0x1111111111111111111111111111111111111111",
      data: "0x1234",
      value: 9n,
    });
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
      nonce: 7,
      to: "0x1111111111111111111111111111111111111111",
      data: "0x",
      value: 0n,
      gas: 21_000n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
    });
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
