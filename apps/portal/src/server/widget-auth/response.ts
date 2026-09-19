import { IdentityConflictError } from "@aomi-labs/account/account";
import {
  WidgetAuthError,
  type WidgetChallenge,
  type AccountSession,
} from "@aomi-labs/account/widget-auth";
import {
  normalizeRequestPath,
  type FailureContext,
  type FailureInput,
} from "@aomi-labs/bff-observability";
import { portalFailures } from "@portal/server/bff/failures";
import { ZodError } from "zod";
import { applyWidgetCors, widgetCorsPreflight } from "./cors";
import { PortalPrincipalError } from "./principal";

/**
 * Provider-token verification failures (para.ts / privy.ts) are thrown as plain
 * `Error`s whose message is a stable snake_case code. They are client faults
 * (a bad/expired/mismatched token), so they map to 401 with that code rather
 * than falling through to a generic 500.
 */
const PROVIDER_TOKEN_ERROR_CODES = new Set([
  "invalid_provider_token",
  "invalid_provider_token_header",
  "invalid_provider_environment",
]);

function providerTokenErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const message = error.message;
  if (PROVIDER_TOKEN_ERROR_CODES.has(message)) return message;
  if (/^provider_token_[a-z0-9_]+$/.test(message)) return message;
  return null;
}

export function identifyWidgetAuthFailure(
  error: unknown,
  context: FailureContext,
): FailureInput {
  if (
    error instanceof WidgetAuthError ||
    error instanceof PortalPrincipalError
  ) {
    return {
      source: "expected",
      error,
      response: { status: error.status, error: error.code },
      context,
    };
  }
  if (error instanceof IdentityConflictError) {
    return {
      source: "expected",
      error,
      response: { status: 409, error: error.code },
      context,
    };
  }
  if (error instanceof ZodError) {
    return {
      source: "expected",
      error,
      response: { status: 400, error: "invalid_request" },
      context,
    };
  }
  const providerTokenCode = providerTokenErrorCode(error);
  if (providerTokenCode) {
    return {
      source: "expected",
      error,
      response: { status: 401, error: providerTokenCode },
      context,
    };
  }
  return {
    source: "local",
    error,
    response: { status: 500, error: "widget_auth_failed" },
    context,
  };
}

/**
 * Wraps a widget route handler so it can return plain `Response`s and throw
 * typed errors: the wrapper applies the cross-origin CORS headers on success
 * and routes thrown errors through the shared failure pipeline.
 */
export function widgetRoute<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
  operation: string,
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    const request = args[0] as Request;
    try {
      return applyWidgetCors(request, await handler(...args));
    } catch (error) {
      const failure = portalFailures.handle(
        identifyWidgetAuthFailure(error, {
          routeFamily: normalizeRequestPath(request.url),
          operation,
          method: request.method,
        }),
      );
      return applyWidgetCors(request, failure.response);
    }
  };
}

/**
 * Builds the OPTIONS/preflight handler for a widget route so routes no longer
 * hand-write `export function OPTIONS`.
 */
export function widgetPreflight(
  methods: readonly string[],
): (request: Request) => Response {
  return (request: Request): Response => widgetCorsPreflight(request, methods);
}

/** The snake_case widget session envelope returned by all issuing routes. */
export function widgetSessionResponse(session: AccountSession): Response {
  return Response.json({
    access_token: session.token,
    token_type: session.tokenType,
    expires_at: session.expiresAt,
    user: { id: session.userId },
  });
}

/** The snake_case challenge envelope returned by the SIWE/SIWS nonce routes. */
export function widgetChallengeResponse(challenge: WidgetChallenge): Response {
  return Response.json({
    nonce: challenge.nonce,
    domain: challenge.domain,
    uri: challenge.uri,
    issued_at: challenge.issuedAt,
    expiration_time: challenge.expirationTime,
  });
}
