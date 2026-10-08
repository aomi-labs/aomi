// =============================================================================
// CLI Solana signer
// =============================================================================
//
// Local-key signing path for `aomi tx sign` when the pending request is
// `solana_sign` kind. The host doesn't decode Solana txs (chain-light) and
// doesn't broadcast — apps splice the returned base64 signed bytes into
// their own `submit_*` continuations. So this signer's job is purely:
//
//   base64 unsigned tx --> deserialize --> sign with keypair --> serialize --> base64
//
// Both versioned (v0) and legacy transactions are supported, matching what
// wallet adapters accept.

import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

export type SolanaSignOutcome = {
  /** Base58 signer pubkey (the keypair's `publicKey.toBase58()`). */
  signer: string;
  /** Base64 of the full signed transaction bytes. */
  signedTxBase64: string;
};

export type SolanaMessageSignOutcome = {
  signer: string;
  /** Base64 Ed25519 signature, matching the backend verifier contract. */
  signatureBase64: string;
};

/**
 * Parse a CLI-provided Solana keypair secret. Accepts either:
 *   - JSON array of 64 bytes (the `solana-keygen` export format)
 *   - base58 of the 64-byte secret key (Phantom / Solflare wallet export)
 *
 * Throws on malformed input.
 */
export function parseSolanaKeypairSecret(input: string): Keypair {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Solana keypair secret is empty.");
  }

  let bytes: Uint8Array;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some((value) => typeof value !== "number")
    ) {
      throw new Error(
        "Solana keypair JSON must be an array of byte values (e.g. `[1,2,...,64]`).",
      );
    }
    bytes = Uint8Array.from(parsed as number[]);
  } else {
    try {
      bytes = bs58.decode(trimmed);
    } catch (err) {
      throw new Error(
        `Failed to decode Solana keypair as base58: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (bytes.length !== 64) {
    throw new Error(
      `Solana keypair secret must be 64 bytes (got ${bytes.length}). Use the full secret key, not just the seed.`,
    );
  }
  return Keypair.fromSecretKey(bytes);
}

function decodeBase64(value: string): Uint8Array {
  // Node and modern browsers both ship Buffer / atob; Buffer is the cleanest
  // base64 path in the CLI runtime.
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Sign a base64-encoded Solana transaction with a local keypair.
 *
 * Tries the versioned-transaction path first (the common case for any
 * post-2022 tx), and falls back to legacy `Transaction` if deserialization
 * as v0 fails. Mirrors what wallet adapters do.
 */
export function signSolanaTransaction(
  unsignedTxBase64: string,
  keypair: Keypair,
): SolanaSignOutcome {
  const bytes = decodeBase64(unsignedTxBase64);

  // Versioned (v0) transactions: deserialize → sign → serialize. The
  // `sign([signer])` call mutates the tx in place and adds the signature
  // for any required signers it has keys for.
  try {
    const versioned = VersionedTransaction.deserialize(bytes);
    versioned.sign([keypair]);
    return {
      signer: keypair.publicKey.toBase58(),
      signedTxBase64: encodeBase64(versioned.serialize()),
    };
  } catch (versionedErr) {
    // Fall through to legacy.
    try {
      const legacy = Transaction.from(bytes);
      legacy.partialSign(keypair);
      return {
        signer: keypair.publicKey.toBase58(),
        signedTxBase64: encodeBase64(legacy.serialize()),
      };
    } catch (legacyErr) {
      const versionedMsg =
        versionedErr instanceof Error
          ? versionedErr.message
          : String(versionedErr);
      const legacyMsg =
        legacyErr instanceof Error ? legacyErr.message : String(legacyErr);
      throw new Error(
        `Failed to deserialize Solana transaction (versioned: ${versionedMsg}; legacy: ${legacyMsg}).`,
      );
    }
  }
}

/** Sign a base64 message with the wallet's Ed25519 keypair. */
export function signSolanaMessage(
  messageBase64: string,
  keypair: Keypair,
): SolanaMessageSignOutcome {
  const message = decodeBase64(messageBase64);
  if (message.length === 0) {
    throw new Error("Solana message must decode to at least one byte.");
  }
  const signature = nacl.sign.detached(message, keypair.secretKey);
  return {
    signer: keypair.publicKey.toBase58(),
    signatureBase64: encodeBase64(signature),
  };
}
