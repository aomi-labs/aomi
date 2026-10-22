/**
 * Wallet signing ACL types — synced from the design mock
 * (aomi-chat-design contracts.ts). Mirrors the backend `SigningMode`
 * on the canonical account response.
 */

/**
 * ACL policy axis — the `public_keys.signing_mode` a user *wants* a wallet to
 * stay in (desired state). Mirrors the backend `SigningMode` enum. `auto` is
 * the server-signed mode an agent wallet may already hold; Settings shows it
 * but never offers it.
 */
export type SignerMode = "manual" | "auto" | "denied";

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
  /** Monotonic authorization_version (bumped by each committed permit). */
  authVersion: number;
  /** Audit label of the last permit that set the mode. */
  lastPermit?: string;
  /** Raw `auth_providers.provider`. */
  provider?: string;
  /**
   * A provisioned agent wallet — only the provider holds key material, so
   * `manual` is meaningless for it.
   */
  providerManaged?: boolean;
}
