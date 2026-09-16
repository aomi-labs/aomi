"use client";

import {
  Connection as SolanaConnection,
  Transaction as SolanaTransaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type {
  WalletSolanaSignMessagePayload,
  WalletSolanaSignPayload,
} from "@aomi-labs/react";
import type { SafeSvmWalletState } from "./wallet-runtime";

function decodeBase64(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function deserializeSolanaTransaction(
  bytes: Uint8Array,
): VersionedTransaction | SolanaTransaction {
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return SolanaTransaction.from(bytes);
  }
}

async function confirmSubmittedTransaction(
  connection: SolanaConnection,
  signature: string,
): Promise<void> {
  const confirmation = await connection.confirmTransaction(
    signature,
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error(
      `Solana transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }
}

export function buildSvmTransactionMethods(
  wallet: SafeSvmWalletState,
  config: {
    rpcHttpUrl: string;
    rpcWsUrl?: string;
    preferDirectSend: boolean;
  },
): {
  signSolanaTransaction?: (
    payload: WalletSolanaSignPayload,
  ) => Promise<{ signedTx: string }>;
  signSolanaMessage?: (
    payload: WalletSolanaSignMessagePayload,
  ) => Promise<{ signature: string }>;
  sendSolanaTransaction?: (
    payload: WalletSolanaSignPayload,
  ) => Promise<{ signature: string; signedTx?: string }>;
  signAndSendSolanaTransaction?: (
    payload: WalletSolanaSignPayload,
  ) => Promise<{ signature: string; signedTx?: string }>;
  solanaRpcHttpUrl: string;
  solanaRpcWsUrl?: string;
} {
  const signTransaction = wallet.signTransaction;
  const signMessage = wallet.signMessage;
  const sendTransaction = wallet.sendTransaction;

  return {
    signSolanaTransaction: signTransaction
      ? async (payload: WalletSolanaSignPayload) => {
          if (!payload.unsignedTx) {
            throw new Error("Missing unsigned_tx payload");
          }
          const tx = deserializeSolanaTransaction(
            decodeBase64(payload.unsignedTx),
          );
          const signed = await signTransaction(tx);
          return { signedTx: encodeBase64(signed.serialize()) };
        }
      : undefined,
    signSolanaMessage: signMessage
      ? async (payload: WalletSolanaSignMessagePayload) => {
          if (payload.signer && payload.signer !== wallet.publicKey) {
            throw new Error("The requested Solana wallet is not connected.");
          }
          if (!payload.message) {
            throw new Error("Missing message payload");
          }
          const signature = await signMessage(decodeBase64(payload.message));
          return { signature: encodeBase64(signature) };
        }
      : undefined,
    sendSolanaTransaction: sendTransaction
      ? async (payload: WalletSolanaSignPayload) => {
          if (!payload.unsignedTx) {
            throw new Error("Missing unsigned_tx payload");
          }
          const connection = new SolanaConnection(
            config.rpcHttpUrl,
            "confirmed",
          );
          const tx = deserializeSolanaTransaction(
            decodeBase64(payload.unsignedTx),
          );
          const signature = await sendTransaction(tx, connection);
          await confirmSubmittedTransaction(connection, signature);
          return { signature };
        }
      : undefined,
    signAndSendSolanaTransaction:
      sendTransaction && config.preferDirectSend
        ? async (payload: WalletSolanaSignPayload) => {
            if (!payload.unsignedTx) {
              throw new Error("Missing unsigned_tx payload");
            }
            const connection = new SolanaConnection(
              config.rpcHttpUrl,
              "confirmed",
            );
            const tx = deserializeSolanaTransaction(
              decodeBase64(payload.unsignedTx),
            );
            const signature = await sendTransaction(tx, connection);
            await confirmSubmittedTransaction(connection, signature);
            return { signature };
          }
        : undefined,
    solanaRpcHttpUrl: config.rpcHttpUrl,
    solanaRpcWsUrl: config.rpcWsUrl,
  };
}
