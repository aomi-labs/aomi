// =============================================================================
// CLI EVM signer — the sign-at-edge peer of `solana-signer.ts`
// =============================================================================
//
// Local-key signing path for `aomi tx sign` when the pending request is an
// `agent_sync` `signing_request`: the backend built and staged the tx, ran
// SigningPolicy, and emitted a raw 32-byte prehash (`raw_payload`). The host
// neither builds nor broadcasts — it signs the digest with the local key and
// returns the signature for `aomi_submit_signature`, which verifies it recovers
// to the bound wallet (backend `verify_edge_signature`, Slice A). So this
// signer's job is purely:
//
//   raw_payload (0x 32-byte hash) --> sign with the EVM key --> 0x 65-byte sig
//
// This is a *raw prehash* sign (`account.sign({ hash })`), NOT an EIP-191
// message sign or EIP-712 typed-data sign (those are the existing
// `transaction` / `eip712_sign` paths). It pairs with the backend's
// `recover_address_from_prehash`, so a CLI signature and the kernel's
// verification agree byte-for-byte.

import { privateKeyToAccount } from "viem/accounts";

export type EvmSignOutcome = {
  /** The `0x` checksummed signer address (the key's derived address). */
  signer: string;
  /** `0x` 65-byte secp256k1 signature over the raw prehash. */
  signature: string;
};

const HEX_32_BYTES = /^0x[0-9a-fA-F]{64}$/;

/** Parse and validate a CLI-provided EVM private key (`0x` + 64 hex chars). */
export function parseEvmPrivateKey(input: string): `0x${string}` {
  const trimmed = input.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!HEX_32_BYTES.test(hex)) {
    throw new Error(
      "EVM private key must be 32 bytes of hex (0x + 64 hex chars).",
    );
  }
  return hex as `0x${string}`;
}

/** Normalize + validate a `raw_payload` digest to a `0x` 32-byte hash. */
function normalizeRawPayload(value: string): `0x${string}` {
  const trimmed = value.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!HEX_32_BYTES.test(hex)) {
    throw new Error(
      "raw_payload must be a 32-byte 0x-prefixed hash (the emitted signing_request digest).",
    );
  }
  return hex as `0x${string}`;
}

/**
 * Sign an `agent_sync` `signing_request.raw_payload` with a local EVM key.
 * Returns the signer address and the raw secp256k1 signature to hand back to
 * `aomi_submit_signature`. The EVM peer of `signSolanaTransaction`.
 */
export async function signEvmRawHash(
  rawPayload: string,
  privateKey: `0x${string}`,
): Promise<EvmSignOutcome> {
  const hash = normalizeRawPayload(rawPayload);
  const account = privateKeyToAccount(privateKey);
  const signature = await account.sign({ hash });
  return { signer: account.address, signature };
}
