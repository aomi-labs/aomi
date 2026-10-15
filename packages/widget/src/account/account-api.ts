"use client";

/** Canonical account wire layer: the signing policy of every linked wallet. */

import type { ShellRequest } from "./transport";
import { accountScopedFetch } from "./settings-api";
import type {
  AomiAccountProfile,
  AomiChainKind,
  AomiOnchainAddress,
  AomiSigningPolicy,
  AomiUserAccount,
} from "@aomi-labs/client";
import type { LinkedVia, SignerMode, WalletPolicy } from "./types";
import { shortAddress } from "@aomi-labs/client";

export type AccountProfile = AomiAccountProfile;
export type OnchainAddress = AomiOnchainAddress;
export type SigningPolicy = AomiSigningPolicy;
export type UserAccount = AomiUserAccount;
type ChainKind = AomiChainKind;

export async function fetchAccountAcl(
  request: ShellRequest = accountScopedFetch,
  signal?: AbortSignal,
): Promise<{ wallets: WalletPolicy[] }> {
  const data = await request<AccountProfile>("/api/account", { signal });
  const owned = new Set(
    data.user_accounts.map((account) => addressKey(account.address)),
  );
  const userAccountsByAddress = new Map(
    data.user_accounts.map((account) => [addressKey(account.address), account]),
  );
  return {
    wallets: data.signing_policies.map((policy) =>
      toWalletPolicy(
        policy,
        userAccountsByAddress.get(addressKey(policy.address)),
        owned,
      ),
    ),
  };
}

function addressKey(address: OnchainAddress): string {
  const value =
    address.chain === "evm" ? address.address.toLowerCase() : address.address;
  return `${address.chain}:${value}`;
}

/**
 * Normalize the kernel's `signing_mode` to the view's `SignerMode`. Only the
 * canonical ladder spellings (`denied → manual → server_auto`) are recognized;
 * anything else fails closed. A retired `client_auto` row reads as Ask me,
 * which is how the backend already treats it.
 */
export function normalizeSignerMode(mode: string): SignerMode {
  switch (mode) {
    case "auto":
    case "server_auto":
      return "auto";
    case "client_auto":
      return "manual";
    case "denied":
      return "denied";
    case "manual":
      return "manual";
    default:
      return "denied";
  }
}

/**
 * Provenance is *derived*, not stored: a key row carries the provider identity
 * it came from, and a key with no provider was necessarily proven by a wallet
 * signature — SIWE on EVM, SIWS on SVM.
 */
function linkedViaOf(
  row: UserAccount | undefined,
  chain: ChainKind,
): LinkedVia {
  const provider = row?.auth_provider?.toLowerCase();
  if (provider === "privy") return "privy";
  if (provider === "para") return "para";
  return chain === "svm" ? "siws" : "siwe";
}

function toWalletPolicy(
  row: SigningPolicy,
  userAccount: UserAccount | undefined,
  ownedAddresses: Set<string>,
): WalletPolicy {
  const chain = row.address.chain;
  return {
    id: `${chain}:${row.address.address}`,
    chain,
    address: row.address.address,
    linkedVia: linkedViaOf(userAccount, chain),
    primary: userAccount?.is_primary ?? false,
    desiredMode: normalizeSignerMode(row.mode),
    authVersion: row.authorization_version,
    lastPermit: formatPermit(row, ownedAddresses),
    provider: userAccount?.auth_provider ?? undefined,
    providerManaged: userAccount?.provider_managed ?? false,
  };
}

/**
 * "you · Jul 12" when the signer was one of this account's own keys — which is
 * the normal case, since a tighten may be signed by any *linked* key, not only
 * the wallet being changed.
 */
function formatPermit(
  row: SigningPolicy,
  ownedAddresses: Set<string>,
): string | undefined {
  const when = formatDate(row.last_authorized_at);
  if (!when) return undefined;
  const by = row.last_authorized_by;
  if (!by) return when;
  return ownedAddresses.has(addressKey(by))
    ? `you · ${when}`
    : `${shortAddress(by.address)} · ${when}`;
}

function formatDate(unixSeconds?: number | null): string | undefined {
  if (!unixSeconds) return undefined;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Turn a failed call into something a person can act on.
 *
 * The authorization endpoints answer with `{"error": "<code>"}` and
 * `accountScopedFetch` rethrows the raw body, so without this the UI would show
 * a user `{"error":"stale_permit"}`. Wallet rejections arrive as provider
 * errors instead and get their own calm phrasing — declining a signature is a
 * choice, not a fault.
 */
export function explainAccountError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);

  if (/user rejected|user denied|rejected the request|4001/i.test(raw)) {
    return "Signature declined — nothing changed.";
  }

  let code = raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      code = String((parsed as { error: unknown }).error);
    }
  } catch {
    // Not JSON — fall through and match the bare text.
  }

  if (code.startsWith("bad_permit")) {
    return "That authorization was malformed. Try again.";
  }
  if (/authentication required/i.test(code)) {
    return "Sign in to see your account.";
  }
  switch (code) {
    case "stale_permit":
      // The version CAS lost — someone (or another tab) committed first.
      return "This wallet changed while you were signing. Reload and try again.";
    case "wrong_signer":
      return "The signature did not match the wallet required for this change. Nothing changed.";
    case "missing_delegated_account":
      return "No active delegated account backs this wallet yet.";
    case "mode_illegal_for_provider":
      return "This wallet's provider can't hold that signing mode.";
    case "unknown_wallet":
      return "This wallet isn't linked to your account.";
    case "forbidden":
      return "You're not authorized to change this wallet.";
    case "already_bound":
      return "This wallet is already linked.";
    case "bad_mode":
      return "Unsupported signing mode.";
    case "internal":
      return "The server hit an error. Try again shortly.";
    case "widget_auth_failed":
      return "Couldn’t authenticate your account. Sign in again and retry.";
    default:
      // Transport failures commonly arrive as structured JSON. Never render
      // an unknown server payload verbatim in Settings; it is implementation
      // detail, not an actionable message for the account holder.
      if (code !== raw) {
        return "Couldn’t load your account. Try again shortly.";
      }
      return raw || "Something went wrong.";
  }
}
