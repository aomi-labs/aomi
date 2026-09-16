"use client";

import { useMemo } from "react";
import {
  Connection as SolanaConnection,
  Transaction as SolanaLegacyTransaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  normalizeSolanaCluster,
  parseChainId,
  walletCapabilities,
  type ActionCapabilities,
  type EvmWallet,
  type SvmWallet,
  type WalletSolanaSignPayload,
  type WalletTxPayload,
} from "@aomi-labs/client";

import { useAomiWalletKit } from "./context";

/** Adapts wallet-kit methods into the wallet subroutines used by ActionHandler. */
export function useActionCapabilities(): ActionCapabilities {
  const wallet = useAomiWalletKit();
  return useMemo(
    () =>
      walletCapabilities({
        ...(wallet.identity.address ? { evm: evmWallet(wallet) } : {}),
        ...(wallet.identity.svmAddress ? { svm: svmWallet(wallet) } : {}),
      }),
    [wallet],
  );
}

function evmWallet(wallet: ReturnType<typeof useAomiWalletKit>): EvmWallet {
  const address = wallet.identity.address;
  if (!address) throw new Error("No EVM wallet is active");
  const sendCalls = wallet.sendTransaction
    ? async ({
      chainId,
      calls,
      }: Parameters<NonNullable<EvmWallet["sendCalls"]>>[0]) => {
        const payload: WalletTxPayload = {
          requestId: "action",
          chainId,
          calls: calls.map((call, index) => ({
            ...call,
            txId: index + 1,
            chainId,
            from: address,
          })),
          txIds: calls.map((_, index) => index + 1),
        };
        const result = await wallet.sendTransaction!(payload, {
          chainIdAlreadySelected: chainId,
        });
        return { hash: result.txHash, hashes: result.txHashes };
      }
    : undefined;

  return {
    address,
    chainId: () => wallet.identity.chainId,
    switchChain: (chainId) => switchEvm(wallet, chainId),
    sendCalls,
    signMessage: wallet.signMessage
      ? async ({ message, chainId }) =>
          wallet.signMessage!({
            non_typed_data: message,
            signer: address,
            chainId,
          })
      : undefined,
    signTypedData: wallet.signTypedData
      ? async ({ typedData, chainId }) =>
          wallet.signTypedData!({
            typed_data: typedData,
            signer: address,
            chainId,
          })
      : undefined,
  };
}

function svmWallet(wallet: ReturnType<typeof useAomiWalletKit>): SvmWallet {
  const address = wallet.identity.svmAddress;
  if (!address) throw new Error("No SVM wallet is active");
  const payload = (
    transactionBase64: string,
    cluster?: string,
  ): WalletSolanaSignPayload => ({
    requestId: "action",
    unsignedTx: transactionBase64,
    cluster,
  });

  return {
    address,
    cluster: () => wallet.selectedSolanaNetwork?.cluster,
    switchCluster: (cluster) => switchSvm(wallet, cluster),
    signTransaction: wallet.signSolanaTransaction
      ? async ({ transactionBase64, cluster }) => {
          const result = await wallet.signSolanaTransaction!(
            payload(transactionBase64, cluster),
          );
          return {
            signedTransaction: result.signedTx,
            signature: extractPayerSignature(result.signedTx),
          };
        }
      : undefined,
    signAndSendTransaction: canSendSvm(wallet)
      ? async ({ transactionBase64, cluster }) => {
          const result = await sendSvm(
            wallet,
            payload(transactionBase64, cluster),
          );
          return {
            signature: result.signature,
            signedTransaction: result.signedTx,
          };
        }
      : undefined,
    signMessage: wallet.signSolanaMessage
      ? async ({ messageBase64, cluster }) => {
          return wallet.signSolanaMessage!({
            message: messageBase64,
            cluster,
          });
        }
      : undefined,
  };
}

async function switchEvm(
  wallet: ReturnType<typeof useAomiWalletKit>,
  chainId: number,
): Promise<void> {
  if (chainId === wallet.identity.chainId) return;
  const supported = wallet.supportedNetworks?.evm?.some(
    (network) => parseChainId(network.id) === chainId,
  );
  if (supported === false || !wallet.switchChain) {
    throw new Error(`The active wallet cannot switch to chain ${chainId}`);
  }
  await wallet.switchChain(chainId);
}

async function switchSvm(
  wallet: ReturnType<typeof useAomiWalletKit>,
  cluster?: string,
): Promise<void> {
  const normalized = normalizeSolanaCluster(cluster);
  if (!normalized) return;
  const target = wallet.supportedNetworks?.solana?.find(
    (network) => network.cluster === normalized,
  );
  if (!target) throw new Error(`Unsupported Solana cluster: ${normalized}`);
  if (wallet.selectedSolanaNetwork?.id === target.id) return;
  if (!wallet.selectNetwork || wallet.solanaNetworkSwitchRequiresReconnect) {
    throw new Error(
      `Reconnect the Solana wallet on ${normalized} before signing`,
    );
  }
  await wallet.selectNetwork({ family: "svm", networkId: target.id });
}

function canSendSvm(wallet: ReturnType<typeof useAomiWalletKit>): boolean {
  return Boolean(
    wallet.signAndSendSolanaTransaction ||
    wallet.sendSolanaTransaction ||
    (wallet.signSolanaTransaction && wallet.solanaRpcHttpUrl),
  );
}

async function sendSvm(
  wallet: ReturnType<typeof useAomiWalletKit>,
  payload: WalletSolanaSignPayload,
): Promise<{ signature: string; signedTx?: string }> {
  if (wallet.signAndSendSolanaTransaction) {
    return wallet.signAndSendSolanaTransaction(payload);
  }
  if (wallet.sendSolanaTransaction)
    return wallet.sendSolanaTransaction(payload);
  if (wallet.signSolanaTransaction && wallet.solanaRpcHttpUrl) {
    const signed = await wallet.signSolanaTransaction(payload);
    const connection = new SolanaConnection(
      wallet.solanaRpcHttpUrl,
      "confirmed",
    );
    const signature = await connection.sendRawTransaction(
      decodeBase64(signed.signedTx),
    );
    await connection.confirmTransaction(signature, "confirmed");
    return { signature, signedTx: signed.signedTx };
  }
  throw new Error("Solana wallet provider is not ready");
}

function extractPayerSignature(signedTransaction: string): string {
  const bytes = decodeBase64(signedTransaction);
  let signature: Uint8Array | null = null;
  try {
    signature = VersionedTransaction.deserialize(bytes).signatures[0] ?? null;
  } catch {
    const legacy = SolanaLegacyTransaction.from(bytes).signature;
    signature = legacy ? new Uint8Array(legacy) : null;
  }
  if (!signature || signature.every((byte) => byte === 0)) {
    throw new Error("The signed transaction carries no payer signature");
  }
  return encodeBase64(signature);
}

function decodeBase64(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined")
    return Buffer.from(bytes).toString("base64");
  return btoa(String.fromCharCode(...bytes));
}
