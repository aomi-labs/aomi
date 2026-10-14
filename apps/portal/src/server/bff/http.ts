import { IdentityConflictError } from "@aomi-labs/account/account";
import { UpstreamUnreachableError } from "@aomi-labs/account/forward";
import { WidgetAuthError } from "@aomi-labs/account/widget-auth";
import {
  normalizeRequestPath,
  type FailureContext,
  type FailureInput,
} from "@aomi-labs/observability";
import { ZodError } from "zod";

import { portalFailures } from "./failures";
import { PrincipalError, protectedResourceMetadataUrl } from "./principal";

/** Signing a backend bearer failed: a server fault, never the caller's. */
class BearerMintError extends Error {
  constructor(cause: unknown) {
    super("bearer_mint_failed", { cause });
    this.name = "BearerMintError";
  }
}

export async function mintBearer<T>(mint: () => Promise<T>): Promise<T> {
  try {
    return await mint();
  } catch (error) {
    throw new BearerMintError(error);
  }
}

export type ErrorShape = {
  operation: string;
  /** Set for OAuth protected resources: auth failures carry an RFC 6750 challenge. */
  resource?: string;
  /** The code an unexpected failure reports. */
  fallback?: string;
};

// Account-library and device-auth failures thrown as plain errors whose
// message is a stable code: bad input from the caller, not a server fault.
const CLIENT_ERROR_CODES = new Map<string, number>([
  ["invalid_provider_token", 401],
  ["invalid_provider_token_header", 401],
  ["invalid_provider_environment", 401],
  ["invalid_better_auth_user_id", 400],
  ["invalid_code_challenge", 400],
  ["invalid_link_intent", 400],
  ["invalid_or_expired_code", 400],
  ["invalid_or_expired_link_intent", 400],
  ["invalid_provider_credential", 400],
  ["invalid_redirect_uri", 400],
  ["invalid_state", 400],
]);

/**
 * The one error mapper. Auth failures become 401/403, caller mistakes keep
 * their 4xx, an unreachable upstream becomes a reported 502, and anything else
 * a reported 500. Error messages never reach the response.
 */
export function errorResponse(
  error: unknown,
  request: Request,
  shape: ErrorShape,
): Response {
  const context: FailureContext = {
    routeFamily: normalizeRequestPath(request.url),
    operation: shape.operation,
    method: request.method,
  };
  const response = portalFailures.handle(
    identify(error, context, shape),
  ).response;
  if (error instanceof PrincipalError && shape.resource)
    return protectedResourceChallenge(error, shape.resource);
  return response;
}

function identify(
  error: unknown,
  context: FailureContext,
  shape: ErrorShape,
): FailureInput {
  const expected = (status: number, code: string): FailureInput => ({
    source: "expected",
    error,
    response: { status, error: code },
    context,
  });
  if (error instanceof PrincipalError || error instanceof WidgetAuthError)
    return expected(error.status, error.code);
  if (error instanceof IdentityConflictError) return expected(409, error.code);
  if (error instanceof ZodError) return expected(400, "invalid_request");
  if (error instanceof Error) {
    const status =
      CLIENT_ERROR_CODES.get(error.message) ??
      (/^provider_token_[a-z0-9_]+$/.test(error.message) ? 401 : undefined);
    if (status) return expected(status, error.message);
  }
  if (error instanceof BearerMintError)
    return {
      source: "local",
      error: error.cause,
      response: { status: 502, error: "bearer_mint_failed" },
      context,
    };
  if (error instanceof UpstreamUnreachableError)
    return {
      source: "upstream_request",
      upstream: "rust",
      error,
      response: { status: 502, error: "upstream_unavailable" },
      context,
    };
  return {
    source: "local",
    error,
    response: { status: 500, error: shape.fallback ?? "internal_error" },
    context,
  };
}

function protectedResourceChallenge(
  error: PrincipalError,
  resource: string,
): Response {
  const code =
    error.status === 401
      ? "invalid_token"
      : error.code === "csrf_failed"
        ? "csrf_failed"
        : "insufficient_scope";
  const headers = new Headers(error.challengeHeaders);
  if (!headers.has("www-authenticate")) {
    const params = [
      `resource_metadata="${protectedResourceMetadataUrl(resource)}"`,
      `error="${code}"`,
      ...(error.requiredScopes.length
        ? [`scope="${error.requiredScopes.join(" ")}"`]
        : []),
    ];
    headers.set("www-authenticate", `Bearer ${params.join(", ")}`);
  }
  return Response.json(
    { error: { code, message: "Authorization failed" } },
    { status: error.status, headers },
  );
}
