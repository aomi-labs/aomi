"use client";

import {
  AccountGraphApiError,
  type AccountGraphLinkedAccount,
  type AccountGraphResponse,
  type AccountGraphUser,
  type AccountGraphWallet,
  type AccountMergeOffer,
} from "@aomi-labs/client";
import type { WalletFamily } from "../types";

/** A link proved a sign-in method of another account; confirming merges it in. */
export type MergeOffer = AccountMergeOffer;

/** The merge offer carried by a failed link or provider exchange, if any. */
export function mergeOfferFrom(error: unknown): MergeOffer | undefined {
  return error instanceof AccountGraphApiError ? error.mergeOffer : undefined;
}

export type AccountRuntimeStatus = "disabled" | "loading" | "ready" | "error";

export type AccountConflictSignal = "wallet" | "identity" | "email";

export type AccountConflict = {
  code: "already_linked_to_another_account";
  signalType: AccountConflictSignal | null;
  provider: string;
  /** Set when one confirm merges that account into this one. */
  mergeOffer?: MergeOffer;
};

export type AomiUserRef = AccountGraphUser;
export type LinkedAuthAccount = AccountGraphLinkedAccount;
export type AccountWallet = AccountGraphWallet;

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

/** `/v1/account`: who is signed in and how. */
export type AomiBackendAccountResponse = AccountGraphResponse;

export type AccountRuntime = {
  status: AccountRuntimeStatus;
  error?: string;
  conflict?: AccountConflict;
  /** True when the browser only has Portal's temporary guest session. */
  guest?: boolean;
  /** Confirmed temporary cookie-session identity; never an account owner. */
  guestUserId?: string;
  user?: AomiUserRef;
  linkedAccounts: LinkedAuthAccount[];
  wallets: AccountWallet[];
  refresh: () => Promise<void>;
  loginProvider?: (reason: string, step?: string) => Promise<void>;
  signOut?: () => Promise<void>;
  deleteAccount?: () => Promise<void>;
  updateAccount?: (input: UpdateAccountInput) => Promise<void>;
  linkWallet?: (input: LinkWalletInput) => Promise<void>;
  updateAuthIdentity?: (input: UpdateLinkedAccountInput) => Promise<void>;
  updateWallet?: (input: UpdateWalletInput) => Promise<void>;
  unlinkWallet?: (walletId: string) => Promise<void>;
  unlinkAuthIdentity?: (identityId: string) => Promise<void>;
  mergeAccount?: (ticket: string) => Promise<{ chats: number }>;
  switchToMergeSource?: (ticket: string) => Promise<void>;
  getAccountBearer?: import("@aomi-labs/client").GetAccountBearer;
};
