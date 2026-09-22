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

/**
 * Embedded wallets a *verified* Privy token attests, read from its
 * `linked_accounts` claim.
 *
 * Privy's `GET /v1/wallets` is the authoritative source where it has the data,
 * but it does not return every wallet a user created through the client SDK —
 * which is every Telegram Mini App user. So this is the same supplementary
 * source Para's descriptor already contributes, and the reason
 * `requireAttestedProviderWallets` merges two sources rather than trusting one.
 *
 * It is not a client claim: the rows come out of a JWT signed by Privy, under
 * the same audience as the `sub` the canonical account is bound to. The
 * boundary that matters is {@link isPrivyEmbeddedWallet} — only Privy-custodied
 * embedded wallets pass. An external wallet merely connected to the session is
 * not Privy-custodied and can never back hosted signing, so it is dropped.
 *
 * Lives here rather than beside its callers because both `privy.ts` (widget
 * exchange) and `account-credentials.ts` (native credential) need it, and
 * `account-credentials.ts` already imports from `privy.ts`.
 */
export function privyTokenWalletAttestations(
  rows: readonly unknown[] | undefined,
): AttestedWallet[] {
  const wallets: AttestedWallet[] = [];
  const seen = new Set<string>();
  for (const row of rows ?? []) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (record.type !== "wallet" || !isPrivyEmbeddedWallet(record)) continue;
    const family = privyTokenWalletFamily(
      record.chain_type ?? record.chainType,
    );
    const address = stringValue(record.address);
    if (!family || !address || !validWalletAddress(family, address)) continue;
    const providerWalletId =
      stringValue(record.id) ?? stringValue(record.wallet_id) ?? address;
    const key = `${family}:${family === "evm" ? address.toLowerCase() : address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wallets.push({
      provider: "privy",
      providerWalletId,
      family,
      address,
      chainScope: null,
    });
  }
  return wallets;
}

function privyTokenWalletFamily(value: unknown): WalletFamily | null {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "ethereum" || normalized === "evm") return "evm";
  if (normalized === "solana" || normalized === "svm") return "svm";
  return null;
}

function isPrivyEmbeddedWallet(row: Record<string, unknown>): boolean {
  const markers = [
    row.wallet_client_type,
    row.walletClientType,
    row.wallet_client,
    row.walletClient,
    row.connector_type,
    row.connectorType,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .filter(Boolean);
  return markers.some(
    (marker) =>
      marker === "privy" ||
      marker === "privy-v2" ||
      marker === "embedded" ||
      marker === "smart_wallet" ||
      marker === "smart-wallet",
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
