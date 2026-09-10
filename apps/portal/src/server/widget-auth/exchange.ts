import { resolveAttestedProviderWallets } from "@aomi-labs/account/account";
import {
  getWidgetProvider,
  widgetCredentialWireSchema,
  type AttestedWallet,
  type VerifiedProviderIdentity,
  type WidgetProviderDescriptor,
} from "@aomi-labs/account/providers";
import { WidgetAuthError } from "@aomi-labs/account/widget-auth";

/**
 * Shared widget provider-exchange pipeline: validate the credential wire,
 * resolve the widget-enabled provider descriptor, validate the provider-shaped
 * credential, and verify the provider token. Both the standalone provider
 * exchange route and the account provider-link route reuse this so the
 * wire → descriptor → gate → credential → verify sequence lives in one place.
 *
 * Malformed input is surfaced as {@link WidgetAuthError} (400) so the central
 * route wrapper maps it to a clean `invalid_request`, never a ZodError-500.
 */
export async function verifyWidgetProviderCredential(body: unknown): Promise<{
  descriptor: WidgetProviderDescriptor;
  identity: VerifiedProviderIdentity;
}> {
  const wire = widgetCredentialWireSchema.safeParse(body);
  if (!wire.success) throw new WidgetAuthError("invalid_request", 400);
  const descriptor = getWidgetProvider(wire.data.provider);
  if (!descriptor) throw new WidgetAuthError("unknown_provider", 400);
  if (!descriptor.policy.widgetEnabled) {
    throw new WidgetAuthError("provider_not_enabled", 400);
  }
  const credential = descriptor.credentialSchema.safeParse(wire.data);
  if (!credential.success) throw new WidgetAuthError("invalid_request", 400);
  const identity = await descriptor.verifyWidgetCredential({
    environment: credential.data.environment,
    providerToken: credential.data.provider_token,
    keyId: credential.data.key_id,
  });
  return { descriptor, identity };
}

/**
 * Resolve the wallets a provider's own server-side API attests for a verified
 * subject, for flows that cannot function without a hosted wallet.
 *
 * A widget credential proves who the human is, nothing more: every widget
 * descriptor deliberately returns `walletAttestations: []` because the wallet
 * arrays inside a provider session token are client-supplied claims. So the
 * only way a provider-custodied wallet may become a canonical `public_keys`
 * row is this call, made with the server's own provider API secret.
 *
 * Each failure keeps its own code so a caller (and the Mini App reading the
 * response) can tell them apart, and none of them fall back to the token's
 * wallet claims:
 * - `provider_wallets_unconfigured` (503) — no server API secret for this
 *   provider in this environment; nothing was asked and nothing is known.
 * - `provider_wallets_unavailable` (503) — the provider API call failed;
 *   transient, and retrying the exchange is the fix.
 * - `provider_hosted_wallet_missing` (422) — the provider answered, and this
 *   user owns no embedded/MPC wallet. External/imported wallets are filtered
 *   out upstream, so they never satisfy this.
 */
export async function requireAttestedProviderWallets(
  identity: VerifiedProviderIdentity,
): Promise<AttestedWallet[]> {
  const resolution = await resolveAttestedProviderWallets({
    provider: identity.provider,
    subject: identity.subject,
    email: identity.email?.value,
    loginIdentifier: identity.loginIdentifier,
  });
  if (resolution.status === "unconfigured") {
    throw new WidgetAuthError("provider_wallets_unconfigured", 503);
  }
  if (resolution.status === "unavailable") {
    throw new WidgetAuthError("provider_wallets_unavailable", 503);
  }
  if (!resolution.wallets.length) {
    throw new WidgetAuthError("provider_hosted_wallet_missing", 422);
  }
  return resolution.wallets;
}
