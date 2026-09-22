import type { FailureInput } from "@aomi-labs/bff-observability";

type DeviceAuthFailureContext = {
  routeFamily: string;
  operation: string;
  fallbackError?: string;
};

const EXPECTED_DEVICE_AUTH_ERRORS = new Set([
  "invalid_better_auth_user_id",
  "invalid_code_challenge",
  "invalid_link_intent",
  "invalid_or_expired_code",
  "invalid_or_expired_link_intent",
  "invalid_provider_credential",
  "invalid_redirect_uri",
  "invalid_state",
]);

export function identifyDeviceAuthFailure(
  error: unknown,
  context: DeviceAuthFailureContext,
): FailureInput {
  const failureContext = {
    routeFamily: context.routeFamily,
    operation: context.operation,
    method: "POST",
  };

  const code = error instanceof Error ? error.message : null;
  if (
    code &&
    (EXPECTED_DEVICE_AUTH_ERRORS.has(code) ||
      /^provider_token_[a-z0-9_]+$/.test(code))
  ) {
    return {
      source: "expected",
      error,
      response: { status: 400, error: code },
      context: failureContext,
    };
  }
  return {
    source: "local",
    error,
    response: {
      status: 500,
      error: context.fallbackError ?? "device_auth_failed",
    },
    context: failureContext,
  };
}
