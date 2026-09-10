import {
  mergeProviderWalletAttestations,
  resolveAttestedProviderWallets,
} from "@aomi-labs/account/account";
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
 * Resolve every wallet this provider attests it custodies for a verified
 * subject, for flows that cannot function without a hosted wallet.
 *
 * Two sources, merged, neither of them a client claim:
 *
 * 1. The provider's own server-side wallet API, queried with our API secret.
 *    Authoritative where it has the data — but Para's `GET /v1/wallets` is
 *    indexed by pregen login handle and simply does not return wallets a user
 *    created through the client SDK, which is every Telegram Mini App user. So
 *    an empty or unavailable answer here proves nothing and must not fail the
 *    exchange on its own.
 * 2. The provider token's own signed wallet attestation. For Para that is
 *    `data.wallets`, signed by the same key, under the same audience, as the
 *    `sub` we bind the canonical account to. External/connected wallets are
 *    stripped upstream and never appear here.
 *
 * This mirrors what the native credential path has always done
 * (`prepareVerifiedCredential` merges the same two sources); the widget path
 * was the outlier in discarding the token attestation.
 *
 * Only an empty merged set is a failure: `provider_hosted_wallet_missing`
 * (422) means neither source knows of an embedded wallet for this user, so
 * there is nothing that could sign.
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
  const wallets = mergeProviderWalletAttestations(
    resolution.status === "attested" ? resolution.wallets : [],
    identity.walletAttestations,
  );
  if (!wallets.length) {
    throw new WidgetAuthError("provider_hosted_wallet_missing", 422);
  }
  return wallets;
}
