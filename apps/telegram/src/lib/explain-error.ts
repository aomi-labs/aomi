/** Turn an internal failure code into something the person holding the phone
 *  can act on.
 *
 *  The authorization endpoints answer `{"error":"<code>"}` and every hook in
 *  this app rethrows a bare code, so without this the Mini App renders strings
 *  like `telegram_privy_identity_token_refresh_failed_...` at the user. The raw
 *  code is still worth keeping — it is what makes a staging failure diagnosable
 *  — so the page shows it behind a disclosure rather than dropping it.
 *
 *  The authorization cases mirror the portal's `explainAccountError`
 *  (`apps/portal/src/features/account/account-api.ts`) so the two surfaces say
 *  the same thing about the same backend code. */
export function explainError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");

  // Declining a signature is a choice, not a fault.
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
    // Not JSON — match the bare text.
  }

  if (code.startsWith("bad_permit")) {
    return "That authorization was malformed. Try again.";
  }
  // Prefix matches: these carry a variable suffix naming the upstream failure.
  if (code.startsWith("telegram_privy_identity_token")) {
    return "Your wallet session expired. Reopen this page from Telegram.";
  }
  if (code.startsWith("telegram_privy_exchange_failed")) {
    return "Aomi could not verify your wallet. Try again shortly.";
  }
  if (code.startsWith("telegram_existing_wallet")) {
    return "That sign-in did not complete. Try again.";
  }
  if (code.startsWith("delegation_signer_rejected")) {
    return "Your wallet provider declined the signing permission. Try again.";
  }
  if (code.startsWith("delegation_begin_failed")) {
    return "Aomi could not start the signing permission. Try again shortly.";
  }

  switch (code) {
    // Authorization ceremony (shared vocabulary with the portal).
    case "stale_permit":
      return "This wallet changed while you were signing. Try again.";
    case "wrong_signer":
      return "The signature did not match the wallet this change needs. Nothing changed.";
    case "missing_delegated_account":
      return "Server signing is not enabled for this wallet yet.";
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

    // Launch.
    case "open_from_telegram":
      return "Open this page from Telegram.";
    case "missing_bot_id":
    case "invalid_telegram_launch":
    case "malformed":
    case "missing_signature":
    case "missing_user":
      return "This link is not valid. Reopen it from Telegram.";
    case "bad_signature":
      return "Telegram could not verify this launch. Reopen it from Telegram.";
    case "expired":
      return "This link has expired. Reopen it from Telegram.";
    case "bot_not_allowed":
      return "This bot is not authorized to open Aomi Wallet.";

    // Identity and account.
    case "telegram_custom_auth_timeout":
    case "telegram_privy_exchange_timeout":
    case "canonical_account_timeout":
      return "Aomi is taking too long to respond. Try again.";
    case "telegram_custom_auth_not_enabled":
    case "telegram_custom_auth_not_configured":
      return "Wallet sign-in is not enabled for this deployment.";
    case "telegram_custom_auth_not_linked":
      return "That wallet is not linked to this Telegram account yet.";
    case "telegram_session_mismatch":
      return "This chat belongs to a different Aomi account.";
    case "already_linked_to_another_account":
      return "That wallet is already linked to another Aomi account.";
    case "provider_hosted_wallet_missing":
      return "Your wallet provider has no wallet for this account yet.";
    case "invalid_widget_origin":
      return "This page is not authorized to reach Aomi.";
    case "canonical_account_missing":
      return "Aomi could not find your account. Try again.";

    // Infrastructure.
    case "internal":
    case "widget_auth_failed":
      return "Aomi hit an error. Try again shortly.";
    case "provider_wallet_api_unavailable":
    case "provider_wallet_api_unconfigured":
      return "Your wallet provider is unreachable. Try again shortly.";

    default:
      // Never render an unknown server payload verbatim — it is implementation
      // detail, not an actionable message.
      return "Something went wrong. Try again.";
  }
}
