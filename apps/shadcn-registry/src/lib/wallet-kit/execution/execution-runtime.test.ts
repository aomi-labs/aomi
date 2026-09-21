import { describe, expect, it, vi } from "vitest";
import { arbitrum } from "viem/chains";
import type { EvmWalletRuntime } from "../runtime/evm/wallet-runtime";
import { buildEvmExecutionRuntime } from "./execution-runtime";

describe("buildEvmExecutionRuntime", () => {
  it("sends a prepared EVM commit through the wallet with its reserved envelope", async () => {
    const address = "0x2222222222222222222222222222222222222222";
    const sendTransaction = vi.fn().mockResolvedValue("0xhash");
    const getWalletClientFor = vi.fn().mockResolvedValue({
      account: { address },
      sendTransaction,
    });
    const evm = {
      activeConnector: { id: "wallet" },
      chainsById: { [arbitrum.id]: arbitrum },
      getWalletClientFor,
      sendTransactionAsync: vi.fn(),
    } as unknown as EvmWalletRuntime;

    await expect(
      buildEvmExecutionRuntime(evm).sendPreparedEvmTransaction?.({
        kind: "evm_transaction",
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
      }),
    ).resolves.toBe("0xhash");
    expect(sendTransaction).toHaveBeenCalledWith({
      account: { address },
      chain: arbitrum,
      type: "eip1559",
      nonce: 7,
      to: "0x1111111111111111111111111111111111111111",
      data: "0x1234",
      value: 9n,
      gas: 25_000n,
      maxFeePerGas: 30n,
      maxPriorityFeePerGas: 2n,
    });
  });

  it("does not advertise prepared wallet sends without provider send support", () => {
    const evm = {
      chainsById: {},
      getWalletClientFor: vi.fn(),
      sendTransactionAsync: undefined,
    } as unknown as EvmWalletRuntime;
    expect(
      buildEvmExecutionRuntime(evm).sendPreparedEvmTransaction,
    ).toBeUndefined();
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
