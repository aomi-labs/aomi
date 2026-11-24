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

// A v1 transaction opens with its version byte; legacy and v0 open with a
// signature count below 0x80. web3.js 1.x cannot decode v1.
const V1_PREFIX = 0x81;

async function signV1(wallet: SafeSvmWalletState, txs: Uint8Array[]) {
  if (!wallet.signV1Transactions) {
    throw new Error("The connected Solana wallet cannot sign v1 transactions.");
  }
  return wallet.signV1Transactions(txs);
}

async function sendV1(
  wallet: SafeSvmWalletState,
  connection: SolanaConnection,
  bytes: Uint8Array,
) {
  const [signed] = await signV1(wallet, [bytes]);
  const signature = await connection.sendRawTransaction(signed);
  await confirmSubmittedTransaction(connection, signature);
  return { signature };
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
  const send = sendTransaction
    ? async (payload: WalletSolanaSignPayload) => {
        if (!payload.unsignedTx) {
          throw new Error("Missing unsigned_tx payload");
        }
        const connection = new SolanaConnection(config.rpcHttpUrl, "confirmed");
        const bytes = decodeBase64(payload.unsignedTx);
        if (bytes[0] === V1_PREFIX) return sendV1(wallet, connection, bytes);
        const tx = deserializeSolanaTransaction(bytes);
        const signature = await sendTransaction(tx, connection);
        await confirmSubmittedTransaction(connection, signature);
        return { signature };
      }
    : undefined;

  return {
    signSolanaTransaction: signTransaction
      ? async (payload: WalletSolanaSignPayload) => {
          if (!payload.unsignedTx) {
            throw new Error("Missing unsigned_tx payload");
          }
          const bytes = decodeBase64(payload.unsignedTx);
          if (bytes[0] === V1_PREFIX) {
            const [signed] = await signV1(wallet, [bytes]);
            return { signedTx: encodeBase64(signed) };
          }
          const tx = deserializeSolanaTransaction(bytes);
          return { signedTx: serializeSigned(await signTransaction(tx)) };
        }
      : undefined,
    signAllSolanaTransactions: signAllTransactions
      ? async (payloads: WalletSolanaSignPayload[]) => {
          const all = payloads.map((payload) => {
            if (!payload.unsignedTx) {
              throw new Error("Missing unsigned_tx payload");
            }
            return decodeBase64(payload.unsignedTx);
          });
          if (all.some((bytes) => bytes[0] === V1_PREFIX)) {
            const signed = await signV1(wallet, all);
            return signed.map((bytes) => ({ signedTx: encodeBase64(bytes) }));
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
