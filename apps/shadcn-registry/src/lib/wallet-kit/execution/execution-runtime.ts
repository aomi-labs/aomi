"use client";

import {
  toViemSignMessageArgs,
  toViemSignTypedDataArgs,
} from "@aomi-labs/react";
import type { EvmExecutionRuntime } from "../composer/types";
import type { EvmWalletRuntime } from "../runtime/evm/wallet-runtime";
import {
  executeWalletKitTransaction,
  getPreferredRpcUrl,
} from "./wallet-execution";

/**
 * Map a shared `EvmWalletRuntime` into the composer's `EvmExecutionRuntime`
 * shape. Every provider lane (Para, Privy, wallets-only) passes the same dozen
 * wagmi passthrough fields; the only differences are provider-specific
 * `overrides` (smart-wallet send/sign), so they spread on top. Keeps the
 * signing surface in one place instead of three copies.
 */
export function buildEvmExecutionRuntime(
  evm: EvmWalletRuntime,
  overrides?: Partial<EvmExecutionRuntime>,
): EvmExecutionRuntime {
  const runtime: EvmExecutionRuntime = {
    activeConnector: evm.activeConnector,
    capabilities: evm.capabilities,
    chainsById: evm.chainsById,
    currentChainId: evm.activeEvmConnection?.chainId,
    getWalletClientFor: evm.getWalletClientFor,
    sendCallsSyncAsync: evm.sendCallsSyncAsync,
    sendTransactionAsync: evm.sendTransactionAsync,
    shouldUseExternalSigner: evm.shouldUseExternalSigner,
    signMessageAsync: evm.signMessageAsync,
    signTypedDataAsync: evm.signTypedDataAsync,
    switchChainAsync: evm.switchChainAsync,
    walletClient: evm.walletClient,
    ...overrides,
  };
  const sendCallsSyncAsync = runtime.sendCallsSyncAsync;
  const sendTransactionAsync = runtime.sendTransactionAsync;
  const signTypedDataAsync = runtime.signTypedDataAsync;
  const switchChainAsync = runtime.switchChainAsync;

  return {
    ...runtime,
    sendTransaction:
      runtime.sendTransaction ??
      (sendTransactionAsync
        ? async (payload, execution) =>
            executeWalletKitTransaction({
              payload,
              state: {
                currentChainId:
                  execution?.chainIdAlreadySelected ?? runtime.currentChainId,
                capabilities: runtime.capabilities,
                nativeWalletExecution: runtime.nativeWalletExecution,
                sendCallsSyncAsync: sendCallsSyncAsync
                  ? async (args) =>
                      sendCallsSyncAsync({
                        ...args,
                        connector: runtime.activeConnector,
                      })
                  : undefined,
                sendTransactionAsync: async (args) =>
                  sendTransactionAsync({
                    ...args,
                    connector: runtime.activeConnector,
                  }),
                switchChainAsync: switchChainAsync
                  ? async ({ chainId }) =>
                      switchChainAsync({
                        chainId,
                        connector: runtime.activeConnector,
                      })
                  : undefined,
                chainsById: runtime.chainsById,
                getPreferredRpcUrl,
                waitForTransactionReceipt: runtime.waitForTransactionReceipt,
              },
            })
        : undefined),
    signTypedData:
      runtime.signTypedData ??
      (signTypedDataAsync
        ? async (payload) => {
            const signArgs = toViemSignTypedDataArgs(payload);
            if (!signArgs) {
              throw new Error("Missing typed_data payload");
            }
            const signature = await signTypedDataAsync({
              ...(signArgs as Record<string, unknown>),
              account: payload.signer ?? evm.activeEvmConnection?.address,
              connector: runtime.activeConnector,
            } as never);
            return { signature };
          }
        : undefined),
    signMessage:
      runtime.signMessage ??
      (evm.signMessageForAccount || runtime.signMessageAsync
        ? async (payload) => {
            const messageArgs = toViemSignMessageArgs(payload);
            if (!messageArgs) {
              throw new Error("Missing non_typed_data payload");
            }
            const activeAccountId = evm.activeAccount?.id;
            if (
              activeAccountId &&
              evm.signMessageForAccount &&
              typeof messageArgs.message === "string"
            ) {
              return {
                signature: await evm.signMessageForAccount({
                  accountId: activeAccountId,
                  message: messageArgs.message,
                  chainId: runtime.currentChainId,
                }),
              };
            }
            // The outer guard admits this branch when only
            // `signMessageForAccount` exists but its preconditions above are not
            // met; fail loudly instead of dereferencing an undefined signer.
            if (!runtime.signMessageAsync) {
              throw new Error("No EVM signer available to sign message");
            }
            const signature = await runtime.signMessageAsync({
              ...(messageArgs as Record<string, unknown>),
              connector: runtime.activeConnector,
            } as never);
            return { signature };
          }
        : undefined),
  };
}
