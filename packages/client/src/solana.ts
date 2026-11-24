import {
  clusterApiUrl,
  type Cluster,
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { AomiError } from "./api-error";
import type { SvmWallet } from "./wallet/types";
import { normalizeSolanaCluster, type SvmCluster } from "./wallet-utils";

/**
 * `signer.svm` from a local keypair: a `Keypair`, a `solana-keygen` JSON
 * byte array, or a base58 secret (the Phantom / Solflare export). `cluster`
 * is the one the wallet reports (default `solana:mainnet`); each commit still
 * broadcasts on its own cluster.
 */
export function solanaSigner(
  key: Keypair | string,
  options: {
    cluster?: SvmCluster;
    /** RPC per cluster; public endpoints otherwise. */
    rpcUrls?: Partial<Record<SvmCluster, string>>;
  } = {},
): SvmWallet {
  const keypair = typeof key === "string" ? parseKeypair(key) : key;
  // A commit names its cluster as the server does (`mainnet-beta`, `devnet`).
  const connection = (name: string) => {
    const cluster = normalizeSolanaCluster(name);
    if (!cluster)
      throw new AomiError(
        "unsupported_cluster",
        `Unknown Solana cluster ${name}`,
      );
    return new Connection(
      options.rpcUrls?.[cluster] ??
        clusterApiUrl(
          cluster === "solana:mainnet"
            ? "mainnet-beta"
            : (cluster.slice(7) as Cluster),
        ),
    );
  };
  return {
    address: keypair.publicKey.toBase58(),
    cluster: options.cluster ?? "solana:mainnet",
    // A local key signs the message bytes of any version.
    canSignV1Transaction: true,
    // A local key signs for any cluster, so it has nothing to switch.
    switchCluster: async () => undefined,
    signTransaction: async ({ transactionBase64 }) => ({
      signedTransaction: signTransaction(transactionBase64, keypair),
    }),
    signAllTransactions: async (inputs) =>
      inputs.map(({ transactionBase64 }) => ({
        signedTransaction: signTransaction(transactionBase64, keypair),
      })),
    broadcastTransaction: async (signed, cluster) =>
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

/** v1 by its prefix byte, then versioned (v0), then legacy, like wallet adapters. */
function signTransaction(base64: string, keypair: Keypair): string {
  const bytes = Buffer.from(base64, "base64");
  if (bytes[0] === 0x81) return signV1(bytes, keypair).toString("base64");
  try {
    const versioned = VersionedTransaction.deserialize(bytes);
    versioned.sign([keypair]);
    return Buffer.from(versioned.serialize()).toString("base64");
  } catch {
    const legacy = Transaction.from(bytes);
    legacy.partialSign(keypair);
    // A new account the transaction creates signs after the wallet.
    return Buffer.from(
      legacy.serialize({ requireAllSignatures: false }),
    ).toString("base64");
  }
}

/**
 * A v1 transaction (SIMD-0385), which web3.js 1.x cannot decode, is its
 * message then one 64-byte signature per required signer. The message is
 * 0x81, a 3-byte header (signer count first), a 4-byte config mask, the
 * 32-byte blockhash, instruction and address counts, then the addresses,
 * signers first.
 */
function signV1(bytes: Buffer, keypair: Keypair): Buffer {
  const signers = bytes[1] ?? 0;
  const messageLength = bytes.length - signers * 64;
  const slot = Array.from({ length: signers }, (_, i) =>
    bytes.subarray(42 + i * 32, 74 + i * 32),
  ).findIndex((key) => keypair.publicKey.toBuffer().equals(key));
  if (slot < 0) {
    throw new AomiError(
      "invalid_transaction",
      "The key is not a signer of this transaction",
    );
  }
  const signed = Buffer.from(bytes);
  signed.set(
    nacl.sign.detached(bytes.subarray(0, messageLength), keypair.secretKey),
    messageLength + slot * 64,
  );
  return signed;
}
