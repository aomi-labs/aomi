"use client";

import type { WalletFamily } from "../types";

export type AccountRuntimeStatus = "disabled" | "loading" | "ready" | "error";

export type AomiUserRef = {
  id: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
};

export type LinkedAuthAccount = {
  id: string;
  provider: string;
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
  kind?: "external" | "embedded" | "smart_account";
  provider?: string;
  providerWalletId?: string;
  chainScope?: string;
  chainId?: number;
  linkedVia:
    | "siwe"
    | "siws"
    | "para"
    | "privy"
    | "challenge"
    | "import"
    | "observed"
    | "migration"
    | (string & {});
  label?: string;
  verifiedAt?: number;
  lastSeenAt?: number;
  capability?: "read" | "write";
};

export type LinkWalletInput = {
  accountId?: string;
  family: WalletFamily;
  address: string;
  chainId?: number;
};

export type UpdateWalletInput = {
  walletId: string;
  label?: string | null;
};

export type UpdateLinkedAccountInput = {
  identityId: string;
  displayLabel?: string | null;
};

export type UpdateAccountInput = {
  displayName?: string | null;
  avatarUrl?: string | null;
};

export type AccountRuntime = {
  status: AccountRuntimeStatus;
  error?: string;
  /** True when the browser only has Portal's temporary guest session. */
  guest?: boolean;
  user?: AomiUserRef;
  linkedAccounts: LinkedAuthAccount[];
  wallets: AccountWallet[];
  refresh: () => Promise<void>;
  signOut?: () => Promise<void>;
  deleteAccount?: () => Promise<void>;
  updateAccount?: (input: UpdateAccountInput) => Promise<void>;
  linkWallet?: (input: LinkWalletInput) => Promise<void>;
  updateAuthIdentity?: (input: UpdateLinkedAccountInput) => Promise<void>;
  updateWallet?: (input: UpdateWalletInput) => Promise<void>;
  unlinkWallet?: (walletId: string) => Promise<void>;
  unlinkAuthIdentity?: (identityId: string) => Promise<void>;
  getAccountBearer?: import("@aomi-labs/client").GetAccountBearer;
};
