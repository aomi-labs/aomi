"use client";

import {
  type WalletSolanaSignMessagePayload,
  type WalletSolanaSignPayload,
} from "@aomi-labs/client";
import {
  Connection as SolanaConnection,
  Transaction as SolanaTransaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { AomiWalletKit } from "@/wallet/types";
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

// A new account the transaction creates signs after the wallet.
function serializeSigned(signed: VersionedTransaction | SolanaTransaction) {
  return encodeBase64(
    signed instanceof VersionedTransaction
      ? signed.serialize()
      : signed.serialize({ requireAllSignatures: false }),
  );
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
  signAllSolanaTransactions?: (
    payloads: WalletSolanaSignPayload[],
  ) => Promise<{ signedTx: string }[]>;
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
  const signAllTransactions = wallet.signAllTransactions;
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
          return { signedTx: serializeSigned(await signTransaction(tx)) };
        }
      : undefined,
    signAllSolanaTransactions: signAllTransactions
      ? async (payloads: WalletSolanaSignPayload[]) => {
          const txs = payloads.map((payload) => {
            if (!payload.unsignedTx) {
              throw new Error("Missing unsigned_tx payload");
            }
            return deserializeSolanaTransaction(
              decodeBase64(payload.unsignedTx),
            );
          });
          const signed = await signAllTransactions(txs);
          return signed.map((tx) => ({ signedTx: serializeSigned(tx) }));
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

type SolanaSender = Pick<
  AomiWalletKit,
  | "signAndSendSolanaTransaction"
  | "sendSolanaTransaction"
  | "signSolanaTransaction"
  | "solanaRpcHttpUrl"
>;

/** Whether this wallet can get a Solana transaction on chain at all. */
export function canSendSolana(kit: SolanaSender): boolean {
  return Boolean(
    kit.signAndSendSolanaTransaction ||
    kit.sendSolanaTransaction ||
    (kit.signSolanaTransaction && kit.solanaRpcHttpUrl),
  );
}

/** Sign and send with the best path the wallet has: direct send, else sign then broadcast. */
export async function sendSolana(
  kit: SolanaSender,
  payload: WalletSolanaSignPayload,
): Promise<{ signature: string; signedTx?: string }> {
  if (kit.signAndSendSolanaTransaction) {
    return kit.signAndSendSolanaTransaction(payload);
  }
  if (kit.sendSolanaTransaction) return kit.sendSolanaTransaction(payload);
  if (kit.signSolanaTransaction && kit.solanaRpcHttpUrl) {
    const signed = await kit.signSolanaTransaction(payload);
    const connection = new SolanaConnection(kit.solanaRpcHttpUrl, "confirmed");
    const signature = await connection.sendRawTransaction(
      decodeBase64(signed.signedTx),
    );
    await connection.confirmTransaction(signature, "confirmed");
    return { signature, signedTx: signed.signedTx };
  }
  throw new Error("Solana wallet provider is not ready");
}
