import { getAddress, isAddress } from "viem";

/** Validate address bytes at the wallet boundary without trusting a mixed-case
 * checksum. The reviewed payload remains unchanged. */
export function normalizeEvmWalletTarget(target: string): `0x${string}` {
  const normalized = getAddress(target.toLowerCase());
  // Address may be augmented to `string` by a consumer's viem Register. Both
  // branches contain address bytes validated above, independent of that alias.
  return (isAddress(target) ? target : normalized) as `0x${string}`;
}
