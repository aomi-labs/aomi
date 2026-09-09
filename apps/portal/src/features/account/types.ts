/**
 * Wallet signing ACL types — synced from the design mock
 * (aomi-chat-design contracts.ts). Mirrors the backend `SigningMode`
 * on the canonical account response.
 */

/**
 * ACL policy axis — the `public_keys.signing_mode` a user *wants* a wallet to
 * stay in (desired state). The runtime reconciles toward it; it is not the
 * runtime's live mode. Mirrors the backend `SigningMode` enum.
 */
export type SignerMode = "manual" | "client_auto" | "auto" | "denied";

/**
 * How a wallet was proven and attached — the tidy provenance set that mirrors
 * the kernel's `auth_providers.provider`. Custody is *derived* from it:
 * siwe/siws → self-custody, privy/para → embedded.
 */
export type LinkedVia = "siwe" | "siws" | "privy" | "para";

/**
 * One `public_keys` row as the account owns it: identity + the ACL (desired
 * signing policy). Chain topology is deliberately absent — that's thread state.
 */
export interface WalletPolicy {
  id: string;
  chain: "evm" | "svm";
  address: string;
  /** How the wallet was proven/attached; drives custody + valid signer modes. */
  linkedVia: LinkedVia;
  /**
   * EIP-6963 rdns (EVM) / wallet-adapter id (SVM) captured at connect time,
   * when known — e.g. "io.metamask", "app.phantom". Display-only; the proof is
   * still `linkedVia`. Absent for older/backfilled wallets → falls back to it.
   */
  rdns?: string;
  primary?: boolean;
  /** The ACL — the committed desired signing mode. */
  desiredMode: SignerMode;
  /** Whether a live delegated account currently backs `auto` (capability axis). */
  delegationActive?: boolean;
  /** Human label for the delegated account's expiry, when relevant. */
  delegationExpiresLabel?: string;
  /** Monotonic authorization_version (bumped by each committed permit). */
  authVersion: number;
  /** Audit label of the last permit that set the mode. */
  lastPermit?: string;
  /** Raw `auth_providers.provider` — what delegation revocation is keyed on. */
  provider?: string;
  /**
   * Whether `auto` is currently offerable, derived from a matching active
   * `DelegatedAccount`. The client must not infer this from the saved policy
   * mode or `linkedVia`: provenance alone is not a signing capability.
   */
  canUseAuto?: boolean;
  /**
   * A provisioned agent wallet — only the provider holds key material, so the
   * client-side modes (`manual`, `client_auto`) are meaningless for it.
   */
  providerManaged?: boolean;
}

/**
 * A `DelegatedAccount` — the capability axis. Its presence + validity is
 * what lets an `auto` ACL actually reconcile.
 */
export interface DelegatedAccountView {
  id: string;
  /** Display name, e.g. "Privy". */
  provider: string;
  /** Raw provider key the revoke route is addressed by, e.g. "privy". */
  providerKey?: string;
  /** Exact identity; scope below is presentation only. */
  address: import("@aomi-labs/client").AomiOnchainAddress;
  scope: string;
  kind: string;
  status: "provisioning" | "active" | "expired" | "revoked" | "unavailable";
}
