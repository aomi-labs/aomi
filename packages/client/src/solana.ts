import {
  clusterApiUrl,
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { AomiError } from "./api-error";
import type { SvmWallet } from "./wallet/types";

/**
 * `signer.svm` from a local keypair: a `Keypair`, a `solana-keygen` JSON
 * byte array, or a base58 secret (the Phantom / Solflare export).
 */
export function solanaSigner(
  key: Keypair | string,
  options: {
    /** RPC per cluster (`solana:mainnet`, `solana:devnet`, `solana:testnet`);
     * public endpoints otherwise. */
    rpcUrls?: Partial<Record<string, string>>;
  } = {},
): SvmWallet {
  const keypair = typeof key === "string" ? parseKeypair(key) : key;
  const connection = (cluster: string) =>
    new Connection(
      options.rpcUrls?.[cluster] ??
        clusterApiUrl(
          cluster === "solana:devnet"
            ? "devnet"
            : cluster === "solana:testnet"
              ? "testnet"
              : "mainnet-beta",
        ),
    );
  return {
    address: keypair.publicKey.toBase58(),
    signTransaction: async ({ transactionBase64 }) => ({
      signedTransaction: signTransaction(transactionBase64, keypair),
    }),
    broadcastTransaction: (signed, cluster) =>
      connection(cluster).sendRawTransaction(Buffer.from(signed, "base64")),
    signMessage: async ({ messageBase64 }) => ({
      signature: Buffer.from(
        nacl.sign.detached(
          Buffer.from(messageBase64, "base64"),
          keypair.secretKey,
        ),
      ).toString("base64"),
    }),
  };
}

function parseKeypair(secret: string): Keypair {
  const trimmed = secret.trim();
  let bytes: Uint8Array;
  try {
    bytes = trimmed.startsWith("[")
      ? Uint8Array.from(JSON.parse(trimmed) as number[])
      : bs58.decode(trimmed);
  } catch {
    throw new AomiError(
      "invalid_key",
      "A Solana secret is a JSON byte array or base58",
    );
  }
  if (bytes.length !== 64)
    throw new AomiError(
      "invalid_key",
      `A Solana secret key is 64 bytes, not ${bytes.length}; pass the full secret, not the seed`,
    );
  return Keypair.fromSecretKey(bytes);
}

/** Versioned (v0) first, then legacy, like wallet adapters. */
function signTransaction(base64: string, keypair: Keypair): string {
  const bytes = Buffer.from(base64, "base64");
  try {
    const versioned = VersionedTransaction.deserialize(bytes);
    versioned.sign([keypair]);
    return Buffer.from(versioned.serialize()).toString("base64");
  } catch {
    const legacy = Transaction.from(bytes);
    legacy.partialSign(keypair);
    return Buffer.from(legacy.serialize()).toString("base64");
  }
}
