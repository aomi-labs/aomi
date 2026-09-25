"use client";

import {
  toViemSignMessageArgs,
  toViemSignTypedDataArgs,
} from "@aomi-labs/react";
import type { EvmExecutionRuntime } from "../composer/types";
import type { EvmWalletRuntime } from "../runtime/evm/wallet-runtime";
import type { WalletClient } from "viem";
import type { EvmWallet } from "@aomi-labs/client";
import {
  executeWalletKitTransaction,
  getPreferredRpcUrl,
} from "./wallet-execution";

type PreparedTransaction = Parameters<
  NonNullable<EvmWallet["sendPreparedTransaction"]>
>[0];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
  const activeAddress = evm.activeEvmConnection?.address;
  const activeConnector = runtime.activeConnector;
  const walletClient = runtime.walletClient as WalletClient | undefined;
  const canSendPreparedTransaction = Boolean(
    (activeConnector && activeAddress && sendTransactionAsync) ||
    walletClient?.account?.type === "local",
  );
  const assertActiveSignerAddress = (payload: PreparedTransaction) => {
    const address = activeAddress ?? walletClient?.account?.address;
    if (!address || address.toLowerCase() !== payload.signer.toLowerCase())
      throw new Error("Expected signing wallet is not active");
  };
  const selectExternalChain = async (payload: PreparedTransaction) => {
    assertActiveSignerAddress(payload);
    if (!activeConnector)
      throw new Error("Expected signing wallet is not connected");
    if (runtime.currentChainId === payload.chain_id) return;
    if (!switchChainAsync)
      throw new Error(`EVM wallet cannot switch to chain ${payload.chain_id}`);
    try {
      await switchChainAsync({
        chainId: payload.chain_id,
        connector: activeConnector,
      });
    } catch (error) {
      throw new Error(`Wallet chain switch failed: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  };
  const localPreparedClient = async (payload: PreparedTransaction) => {
    const client = walletClient;
    assertActiveSignerAddress(payload);
    const account = client?.account;
    if (!account || account.type !== "local")
      throw new Error("Prepared local wallet client is unavailable");
    if ((await client.getChainId()) !== payload.chain_id)
      throw new Error("Expected signing wallet is on the wrong chain");
    const chain = runtime.chainsById[payload.chain_id];
    if (!chain) throw new Error("Commit chain is not configured");
    return { client, chain, account };
  };

  return {
    ...runtime,
    preparePreparedEvmTransaction:
      runtime.preparePreparedEvmTransaction ??
      (canSendPreparedTransaction
        ? async (payload) => {
            if (!activeConnector) {
              await localPreparedClient(payload);
              return;
            }
            // Keep preflight local. Injected providers are allowed to defer or
            // suppress account/chain RPCs until a user-visible wallet request;
            // awaiting those calls here used to hang before Commit Service
            // could create the durable attempt. The cached registry identity
            // is the identity the user selected, and the actual transaction is
            // still pinned to this connector and verified on-chain by Commit
            // Service before the commit can advance.
            assertActiveSignerAddress(payload);
            if (!runtime.chainsById[payload.chain_id])
              throw new Error("Commit chain is not configured");
            if (
              runtime.currentChainId !== payload.chain_id &&
              !switchChainAsync
            )
              throw new Error(
                `EVM wallet cannot switch to chain ${payload.chain_id}`,
              );
          }
        : undefined),
    sendPreparedEvmTransaction:
      runtime.sendPreparedEvmTransaction ??
      (canSendPreparedTransaction
        ? async (payload) => {
            const tx = payload.transaction;
            if (activeConnector && sendTransactionAsync) {
              await selectExternalChain(payload);
              // Browser sends use the wallet's current pending nonce. The
              // staged nonce may have changed before the user approves.
              return sendTransactionAsync({
                account: payload.signer as `0x${string}`,
                chainId: payload.chain_id,
                connector: activeConnector,
                to: tx.to as `0x${string}`,
                data: tx.data as `0x${string}`,
                value: BigInt(tx.value),
              }).catch((error) => {
                throw new Error(
                  `Wallet transaction request failed: ${errorMessage(error)}`,
                  { cause: error },
                );
              });
            }
            const { client, chain, account } =
              await localPreparedClient(payload);
            return client.sendTransaction({
              account,
              chain,
              type: "eip1559",
              to: tx.to as `0x${string}`,
              data: tx.data as `0x${string}`,
              value: BigInt(tx.value),
              gas: BigInt(tx.gas_limit),
              maxFeePerGas: BigInt(tx.max_fee_per_gas),
              maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas),
            });
          }
        : undefined),
    signEvmTransaction:
      runtime.signEvmTransaction ??
      (async (payload) => {
        const client = (
          runtime.activeConnector
            ? await runtime.getWalletClientFor({
                connector: runtime.activeConnector,
              })
            : runtime.walletClient
        ) as WalletClient | undefined;
        if (
          !client?.account ||
          client.account.address.toLowerCase() !== payload.signer.toLowerCase()
        )
          throw new Error("Expected signing wallet is not active");
        const chain = runtime.chainsById[payload.chain_id];
        if (!chain) throw new Error("Commit chain is not configured");
        const tx = payload.transaction;
        return client.signTransaction({
          account: client.account,
          chain,
          type: "eip1559",
          nonce: payload.nonce,
          to: tx.to as `0x${string}`,
          data: tx.data as `0x${string}`,
          value: BigInt(tx.value),
          gas: BigInt(tx.gas_limit),
          maxFeePerGas: BigInt(tx.max_fee_per_gas),
          maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas),
        });
      }),
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
