/**
 * Solana v1 transactions (SIMD-0385) in wire form, without web3.js, which
 * cannot decode them. A v1 transaction is its message followed by one
 * 64-byte signature per required signer, with no length prefix:
 *
 *   0x81 | header (3) | config mask (4) | blockhash (32)
 *   | instruction count (1) | address count (1) | addresses (32 each) | …
 *   | signatures (64 × header.num_required_signatures)
 *
 * The message, version prefix included, is what each signer signs.
 */

export const V1_PREFIX = 0x81;
const SIGNATURE_SIZE = 64;
const ADDRESS_SIZE = 32;
const ADDRESSES_OFFSET = 1 + 3 + 4 + 32 + 1 + 1;

/** Legacy and v0 open with a signature count below 0x80; v1 with 0x81. */
export function isV1Transaction(bytes: Uint8Array): boolean {
  return bytes[0] === V1_PREFIX;
}

export type V1Transaction = {
  /** The bytes every signer signs. */
  message: Uint8Array;
  /** The required signers' addresses, in signature-slot order. */
  signers: Uint8Array[];
  /** Puts `signature` in `signer`'s slot and answers the new wire bytes. */
  withSignature: (signer: Uint8Array, signature: Uint8Array) => Uint8Array;
};

export function parseV1Transaction(bytes: Uint8Array): V1Transaction {
  if (!isV1Transaction(bytes)) throw new Error("Not a v1 transaction");
  const required = bytes[1] ?? 0;
  const addressCount = bytes[ADDRESSES_OFFSET - 1] ?? 0;
  const messageLength = bytes.length - required * SIGNATURE_SIZE;
  if (
    required === 0 ||
    addressCount < required ||
    messageLength < ADDRESSES_OFFSET + addressCount * ADDRESS_SIZE
  ) {
    throw new Error("Malformed v1 transaction");
  }
  const signers = Array.from({ length: required }, (_, slot) => {
    const start = ADDRESSES_OFFSET + slot * ADDRESS_SIZE;
    return bytes.slice(start, start + ADDRESS_SIZE);
  });
  return {
    message: bytes.slice(0, messageLength),
    signers,
    withSignature: (signer, signature) => {
      if (signature.length !== SIGNATURE_SIZE) {
        throw new Error("A Solana signature is 64 bytes");
      }
      const slot = signers.findIndex((key) => sameBytes(key, signer));
      if (slot < 0)
        throw new Error("The key is not a signer of this transaction");
      const signed = bytes.slice();
      signed.set(signature, messageLength + slot * SIGNATURE_SIZE);
      return signed;
    },
  };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((b, i) => b === right[i]);
}
