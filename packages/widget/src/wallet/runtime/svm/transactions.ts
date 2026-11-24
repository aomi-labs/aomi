"use client";

import {
  normalizeSolanaCluster,
  type WalletSolanaSignMessagePayload,
  type WalletSolanaSignPayload,
} from "@aomi-labs/client";
import {
  Connection as SolanaConnection,
  Transaction as SolanaTransaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { DEFAULT_SVM_CLUSTER } from "@/wallet/catalog/svm-networks";
import type { AomiWalletKit } from "@/wallet/types";
import type { SafeSvmWalletState } from "./wallet-runtime";

export function decodeBase64(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * A v1 transaction (SIMD-0385) opens with its version prefix, 0x81. Legacy
 * and v0 transactions open with their signature count, which is below 0x80.
 */
export function isV1TransactionBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 0x81;
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
  const signV1Transactions = wallet.signV1Transactions;

  // web3.js 1.x cannot decode v1, so a v1 transaction goes to the wallet as
  // bytes. Only a wallet that listed version 1 gets a v1 transaction.
  const signV1 = async (all: Uint8Array[]): Promise<Uint8Array[]> => {
    if (!signV1Transactions) {
      throw new Error(
        "The connected Solana wallet cannot sign v1 transactions.",
      );
    }
    return signV1Transactions(all);
  };
  const sendV1 = async (bytes: Uint8Array) => {
    const [signed] = await signV1([bytes]);
    const connection = new SolanaConnection(config.rpcHttpUrl, "confirmed");
    const signature = await connection.sendRawTransaction(signed);
    await confirmSubmittedTransaction(connection, signature);
    return { signature, signedTx: encodeBase64(signed) };
  };
  const unsignedBytes = (payload: WalletSolanaSignPayload) => {
    if (!payload.unsignedTx) {
      throw new Error("Missing unsigned_tx payload");
    }
    return decodeBase64(payload.unsignedTx);
  };
  const send = sendTransaction
    ? async (payload: WalletSolanaSignPayload) => {
        const bytes = unsignedBytes(payload);
        if (isV1TransactionBytes(bytes)) return sendV1(bytes);
        const connection = new SolanaConnection(config.rpcHttpUrl, "confirmed");
        const tx = deserializeSolanaTransaction(bytes);
        const signature = await sendTransaction(tx, connection);
        await confirmSubmittedTransaction(connection, signature);
        return { signature };
      }
    : undefined;

  return {
    signSolanaTransaction:
      signTransaction || signV1Transactions
        ? async (payload: WalletSolanaSignPayload) => {
            const bytes = unsignedBytes(payload);
            if (isV1TransactionBytes(bytes)) {
              const [signed] = await signV1([bytes]);
              return { signedTx: encodeBase64(signed) };
            }
            if (!signTransaction) {
              throw new Error("The connected Solana wallet cannot sign.");
            }
            const tx = deserializeSolanaTransaction(bytes);
            return { signedTx: serializeSigned(await signTransaction(tx)) };
          }
        : undefined,
    signAllSolanaTransactions:
      signAllTransactions || signV1Transactions
        ? async (payloads: WalletSolanaSignPayload[]) => {
            const all = payloads.map(unsignedBytes);
            if (all.some(isV1TransactionBytes)) {
              // The Wallet Standard feature signs bytes of any version in one
              // prompt, so a mixed batch stays one prompt too.
              const signed = await signV1(all);
              return signed.map((bytes) => ({ signedTx: encodeBase64(bytes) }));
            }
            if (!signAllTransactions) {
              throw new Error("The connected Solana wallet cannot sign.");
            }
            const signed = await signAllTransactions(
              all.map(deserializeSolanaTransaction),
            );
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
    sendSolanaTransaction: send,
    signAndSendSolanaTransaction: config.preferDirectSend ? send : undefined,
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
  | "selectedSolanaNetwork"
>;

/** Whether this wallet can get a Solana transaction on chain at all. */
export function canSendSolana(kit: SolanaSender): boolean {
  return Boolean(
    kit.signAndSendSolanaTransaction ||
    kit.sendSolanaTransaction ||
    (kit.signSolanaTransaction && kit.solanaRpcHttpUrl),
  );
}

/**
 * Sign and send with the best path the wallet has: direct send, else sign
 * then broadcast. Only on the cluster the payload names: the wallet's RPC is
 * the selected network's.
 */
export async function sendSolana(
  kit: SolanaSender,
  payload: WalletSolanaSignPayload,
): Promise<{ signature: string; signedTx?: string }> {
  const here = kit.selectedSolanaNetwork?.cluster ?? DEFAULT_SVM_CLUSTER;
  if (payload.cluster && normalizeSolanaCluster(payload.cluster) !== here)
    throw new Error(
      `This transaction is for ${payload.cluster}, and your Solana wallet here is on ${here}. Nothing was sent.`,
    );
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
    await confirmSubmittedTransaction(connection, signature);
    return { signature, signedTx: signed.signedTx };
  }
  throw new Error("Solana wallet provider is not ready");
}
