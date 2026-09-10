import type { WalletFamily } from "../types";

export type AttestedWalletProvider = "privy" | "para" | (string & {});

/** The login handle a provider verified for this session, verbatim: Para's
 *  `data.authType` / `data.identifier`. It is what a provider's own wallet API
 *  is keyed by — those APIs are partner-scoped and look wallets up by the
 *  user's login handle, not by the session token's subject — so an attester
 *  that has one can ask a question the subject alone cannot express. */
export type ProviderLoginIdentifier = {
  /** Provider-native identifier type, e.g. Para `email` / `telegram`. */
  type: string;
  value: string;
};

export type WalletAttester = (input: {
  /** Verified provider-token subject. */
  subject: string;
  email?: string | null;
  loginIdentifier?: ProviderLoginIdentifier | null;
}) => Promise<AttestedWallet[] | null>;

export type WalletAttesterRegistry = Record<string, WalletAttester | undefined>;

export type WalletAttestationLogger = Pick<typeof console, "warn">;

/** A wallet the provider attests is owned by the verified user and currently
 * custodied by that provider. Only these are eligible to become
 * canonical `public_keys` rows with provider provenance. */
export interface AttestedWallet {
  provider: AttestedWalletProvider;
  /** Stable provider-side wallet id for later server-side signing lookups. */
  providerWalletId: string;
  family: WalletFamily;
  address: string;
  /** Chain scope for the caip-10 derivation. `null` keeps the unique-index
   * key consistent with the SIWE convention (`coalesce(chain_scope,'*')`). */
  chainScope: string | null;
}

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// Solana base58 addresses: 32-44 chars, no 0/O/I/l.
const SVM_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validWalletAddress(
  family: WalletFamily,
  address: unknown,
): address is string {
  return (
    typeof address === "string" &&
    (family === "evm"
      ? EVM_ADDRESS_RE.test(address)
      : SVM_ADDRESS_RE.test(address))
  );
}
