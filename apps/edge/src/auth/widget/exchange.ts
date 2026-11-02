import {
  getWidgetProvider,
  widgetCredentialWireSchema,
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
