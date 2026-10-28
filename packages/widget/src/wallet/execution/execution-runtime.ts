"use client";

import { toViemSignMessageArgs, toViemSignTypedDataArgs } from "@aomi-labs/client";
import { walletDebug } from "@/wallet/wallet-debug";
import type { EvmExecutionRuntime } from "@/wallet/composer/types";
import type { EvmWalletRuntime } from "@/wallet/runtime/evm/wallet-runtime";
import type { Address, WalletClient } from "viem";
import {
  normalizeEvmWalletTarget,
  partialWalletExecution,
} from "@aomi-labs/client";
import type { EvmWallet, WalletEip712Payload } from "@aomi-labs/client";
import {
  executeWalletKitTransaction,
  getPreferredRpcUrl,
  sendWalletCallBundle,
  describeAtomicBatch,
  waitForReceipt,
} from "./wallet-execution";
import {
  knownNoBatch,
  markNoBatch,
} from "@/wallet/runtime/evm/capability-probe";
import { shouldProbeWalletCapabilities } from "@/wallet/runtime/evm/wagmi-hooks";

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
  const capabilities = runtime.capabilities;
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
  // EIP-5792 bundles go through the connected wallet only.
  const canSendPreparedCalls = Boolean(
    activeConnector &&
    activeAddress &&
    sendTransactionAsync &&
    sendCallsSyncAsync,
  );
  // Rabby isn't probed (its probe prompts the user), so it isn't bundled.
  const batches =
    canSendPreparedCalls &&
    shouldProbeWalletCapabilities({
      account: activeAddress as Address | undefined,
      connector: activeConnector,
      stableId: evm.activeEvmConnection?.stableId,
      walletName: evm.activeEvmConnection?.walletName,
    });
  const signMessageAsync = runtime.signMessageAsync;
  // A message commit is signed by the wallet the user connected (pinned to
  // its connector), or a local account.
  const canSignPreparedMessage = Boolean(
    (activeConnector &&
      activeAddress &&
      signTypedDataAsync &&
      signMessageAsync) ||
    walletClient?.account?.type === "local",
  );
  const assertActiveSignerAddress = (payload: { signer: string }) => {
    const address = activeAddress ?? walletClient?.account?.address;
    if (!address || address.toLowerCase() !== payload.signer.toLowerCase())
      throw new Error("Expected signing wallet is not active");
  };
  const selectExternalChain = async (
    payload: PreparedTransaction,
    onPhase?: Parameters<NonNullable<EvmWallet["sendPreparedTransaction"]>>[1],
  ) => {
    assertActiveSignerAddress(payload);
    if (!activeConnector)
      throw new Error("Expected signing wallet is not connected");
    if (runtime.currentChainId === payload.chain_id) return;
    if (!switchChainAsync)
      throw new Error(`EVM wallet cannot switch to chain ${payload.chain_id}`);
    onPhase?.("switching_chain");
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
            normalizeEvmWalletTarget(payload.transaction.to);
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
        ? async (payload, onPhase) => {
            const tx = payload.transaction;
            const to = normalizeEvmWalletTarget(tx.to);
            if (activeConnector && sendTransactionAsync) {
              await selectExternalChain(payload, onPhase);
              // Browser sends use the wallet's current pending nonce. The
              // staged nonce may have changed before the user approves.
              onPhase?.("awaiting_wallet");
              return sendTransactionAsync({
                account: payload.signer as `0x${string}`,
                chainId: payload.chain_id,
                connector: activeConnector,
                to,
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
            onPhase?.("submitting");
            return client.sendTransaction({
              account,
              chain,
              type: "eip1559",
              to,
              data: tx.data as `0x${string}`,
              value: BigInt(tx.value),
              gas: BigInt(tx.gas_limit),
              maxFeePerGas: BigInt(tx.max_fee_per_gas),
              maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas),
            });
          }
        : undefined),
    // Display only: the wagmi public client for the chain, else its RPC.
    waitForEvmReceipt:
      runtime.waitForEvmReceipt ??
      evm.waitForReceipt ??
      (({ chainId, hash }) =>
        waitForReceipt(
          {
            chainsById: runtime.chainsById,
            waitForTransactionReceipt: runtime.waitForTransactionReceipt,
          },
          chainId,
          hash as `0x${string}`,
        )),
    supportsAtomicEvmBatch:
      runtime.supportsAtomicEvmBatch ??
      (batches
        ? (chainId) => {
            const decision = knownNoBatch(
              activeConnector!.uid,
              chainId,
              activeAddress!,
            )
              ? { supported: false, reason: "refused" }
              : describeAtomicBatch(capabilities, chainId);
            walletDebug("aa:batch-decision", {
              chainId,
              connector: activeConnector?.id,
              ...decision,
            });
            return decision.supported;
          }
        : undefined),
    sendPreparedEvmCalls:
      runtime.sendPreparedEvmCalls ??
      (canSendPreparedCalls
        ? async (payload, onPhase) => {
            assertActiveSignerAddress(payload);
            if (!runtime.chainsById[payload.chain_id])
              throw new Error("Commit chain is not configured");
            return sendWalletCallBundle({
              onRefused: () =>
                markNoBatch(
                  activeConnector!.uid,
                  payload.chain_id,
                  payload.signer,
                ),
              calls: payload.calls.map((call) => ({
                chainId: payload.chain_id,
                to: normalizeEvmWalletTarget(call.to),
                value: BigInt(call.value),
                data: call.data as `0x${string}`,
              })),
              state: {
                currentChainId: runtime.currentChainId,
                capabilities,
                sendCallsSyncAsync: (args) =>
                  sendCallsSyncAsync!({
                    ...args,
                    account: payload.signer as `0x${string}`,
                    connector: activeConnector,
                  }),
                sendTransactionAsync: (args) =>
                  sendTransactionAsync!({
                    ...args,
                    account: payload.signer as `0x${string}`,
                    connector: activeConnector,
                  }),
                switchChainAsync: switchChainAsync
                  ? ({ chainId }) =>
                      switchChainAsync({ chainId, connector: activeConnector })
                  : undefined,
                chainsById: runtime.chainsById,
                getPreferredRpcUrl,
                waitForTransactionReceipt: runtime.waitForTransactionReceipt,
              },
              onPhase,
            }).catch((error) => {
              if (partialWalletExecution(error)) throw error;
              throw new Error(
                `Wallet batch request failed: ${errorMessage(error)}`,
                { cause: error },
              );
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
    signPreparedEvmMessage:
      runtime.signPreparedEvmMessage ??
      (canSignPreparedMessage
        ? async (payload) => {
            assertActiveSignerAddress(payload);
            const account = payload.signer as `0x${string}`;
            const message = payload.message;
            const typed =
              message.format === "typed_data"
                ? toViemSignTypedDataArgs({
                    typed_data:
                      message.typed_data as WalletEip712Payload["typed_data"],
                  })
                : undefined;
            // `0x` hex is signed as its bytes, other text as UTF-8.
            const personal =
              message.format === "personal"
                ? toViemSignMessageArgs({ non_typed_data: message.message })
                : undefined;
            if (!typed && !personal)
              throw new Error("Message commit has nothing to sign");
            if (activeConnector && signTypedDataAsync && signMessageAsync)
              return (
                typed
                  ? signTypedDataAsync({
                      ...typed,
                      account,
                      connector: activeConnector,
                    })
                  : signMessageAsync({
                      ...personal,
                      account,
                      connector: activeConnector,
                    })
              ).catch((error: unknown) => {
                throw new Error(
                  `Wallet signature request failed: ${errorMessage(error)}`,
                  { cause: error },
                );
              });
            const local = walletClient?.account;
            if (!walletClient || local?.type !== "local")
              throw new Error("Expected signing wallet is not connected");
            return typed
              ? walletClient.signTypedData({
                  ...(typed as Parameters<WalletClient["signTypedData"]>[0]),
                  account: local,
                })
              : walletClient.signMessage({
                  ...(personal as Parameters<WalletClient["signMessage"]>[0]),
                  account: local,
                });
          }
        : undefined),
    sendTransaction:
      runtime.sendTransaction ??
      (sendTransactionAsync
        ? async (payload, execution) =>
            executeWalletKitTransaction({
              payload,
              state: {
                currentChainId:
                  execution?.chainIdAlreadySelected ?? runtime.currentChainId,
                capabilities,
                nativeWalletExecution: runtime.nativeWalletExecution,
                sendCallsSyncAsync: sendCallsSyncAsync
                  ? async (args) =>
                      sendCallsSyncAsync({
                        ...args,
                        account: activeAddress as `0x${string}` | undefined,
                        connector: runtime.activeConnector,
                      })
                  : undefined,
                sendTransactionAsync: async (args) =>
                  sendTransactionAsync({
                    ...args,
                    account: activeAddress as `0x${string}` | undefined,
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
