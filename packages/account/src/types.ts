export type AomiUserId = string;
export type BetterAuthUserId = string;
export type WalletFamily = "evm" | "svm";
export type WalletKind = "external" | "embedded" | "smart_account";
export type KnownLinkedVia =
  | "siwe"
  | "siws"
  | "privy"
  | "para"
  | "import"
  | "observed"
  | "migration";
export type LinkedVia = KnownLinkedVia | (string & {});
export type KnownAuthIdentityProvider =
  | "better_auth"
  | "siwe"
  | "siws"
  | "privy"
  | "para"
  | "email";
export type AuthIdentityProvider = KnownAuthIdentityProvider | (string & {});

/** Canonical `(issuerEnvironment, tenantId)` scope for every provider whose
 * scope is fixed by the identity graph rather than a runtime credential. One
 * owner for the tuples that were previously re-derived at each call site. */
export const IDENTITY_SCOPES = {
  betterAuth: { issuerEnvironment: "aomi", tenantId: "portal" },
  email: { issuerEnvironment: "aomi", tenantId: "global" },
  siwe: { issuerEnvironment: "eip155", tenantId: "global" },
  siws: { issuerEnvironment: "solana", tenantId: "global" },
} as const;

export type DbAomiUser = {
  id: AomiUserId;
  betterAuthUserId: BetterAuthUserId | null;
  displayName: string | null;
  primaryEmail: string | null;
  avatarUrl: string | null;
  metadata: Record<string, unknown>;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DbAomiAuthIdentity = {
  id: string;
  userId: AomiUserId;
  provider: AuthIdentityProvider;
  issuerEnvironment: string;
  tenantId: string;
  subject: string;
  email: string | null;
  displayLabel: string | null;
  providerMetadata: Record<string, unknown>;
  linkedAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
};

export type DbAomiWallet = {
  id: string;
  userId: AomiUserId;
  family: WalletFamily;
  address: string;
  normalizedAddress: string;
  caip10: string | null;
  chainScope: string | null;
  kind: WalletKind;
  provider: string | null;
  providerWalletId: string | null;
  linkedVia: LinkedVia;
  label: string | null;
  displayMetadata: Record<string, unknown>;
  verifiedAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
};

export type AomiUserRef = {
  id: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
};

export type LinkedAuthAccount = {
  id: string;
  provider: string;
  issuerEnvironment: string;
  tenantId: string;
  subject: string;
  email?: string;
  displayLabel?: string;
  linkedAt?: number;
  lastSeenAt?: number;
};

export type AccountWallet = {
  id: string;
  family: WalletFamily;
  address: string;
  kind?: WalletKind;
  provider?: string;
  providerWalletId?: string;
  chainScope?: string;
  chainId?: number;
  linkedVia: LinkedVia | (string & {});
  label?: string;
  verifiedAt?: number;
  lastSeenAt?: number;
};

export type AomiAccountResponse =
  | {
      user: AomiUserRef;
      linkedAccounts: LinkedAuthAccount[];
      wallets: AccountWallet[];
      session:
        | {
            carrier: "better_auth";
            betterAuthUserId: string;
            expiresAt?: number;
            fresh?: boolean;
          }
        | {
            carrier: "widget";
            expiresAt: number;
            authMethod: string;
          };
    }
  | {
      user: null;
      linkedAccounts: [];
      wallets: [];
      session: null;
    };

// Deliberately open (not a closed union of provider names): shared account
// code must stay provider-agnostic per the descriptor boundary; concrete
// providers are validated at runtime against the registered descriptors.
export type AccountCredentialProvider = string;

export type AomiAccountCredential = {
  provider: string;
  tokenKind?: string;
  providerToken: string;
  keyId?: string;
};

export type VerifiedPrivyToken = {
  subject: string;
  sessionId?: string;
  audience: string;
  issuer: "privy.io";
  expiresAt: number;
  email?: string;
  emailVerified?: boolean;
  displayLabel?: string;
  linkedAccounts?: unknown[];
  rawClaims: Record<string, unknown>;
};

export type VerifiedParaJwt = {
  subject: string;
  audience: string;
  expiresAt: number;
  email?: string;
  emailVerified?: boolean;
  displayLabel?: string;
  wallets?: unknown[];
  connectedWallets?: unknown[];
  rawClaims: Record<string, unknown>;
};

export type SignalRef =
  | {
      type: "wallet";
      family: WalletFamily;
      normalizedAddress: string;
      chainScope: string | null;
    }
  | {
      type: "identity";
      provider: AuthIdentityProvider;
      issuerEnvironment: string;
      tenantId: string;
      subject: string;
    }
  | { type: "email"; email: string };

export type SignalResolution =
  | { status: "linked" }
  | { status: "noop" }
  | {
      status: "conflict";
      reason: "already_linked_to_another_account";
      signalType: SignalRef["type"];
    };
