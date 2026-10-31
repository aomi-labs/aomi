import { IdentityConflictError } from "@aomi-labs/account/account";
import { WidgetAuthError } from "@aomi-labs/account/widget-auth";
import { ZodError } from "zod";

import { EdgeError, errorResponse } from "../kernel/errors";

// Account-library failures thrown as plain errors whose
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

/** The account library's failures in the edge's one error type; anything else stays a server fault. */
function asEdgeError(error: unknown): unknown {
  if (error instanceof EdgeError) return error;
  if (error instanceof WidgetAuthError) return new EdgeError(error.status, error.code, { cause: error });
  if (error instanceof IdentityConflictError) return new EdgeError(409, error.code, { cause: error });
  if (error instanceof ZodError) return new EdgeError(400, "invalid_request", { cause: error });
  if (error instanceof Error) {
    const status =
      CLIENT_ERROR_CODES.get(error.message) ??
      (/^provider_token_[a-z0-9_]+$/.test(error.message) ? 401 : undefined);
    if (status) return new EdgeError(status, error.message, { cause: error });
  }
  return error;
}

/**
 * The one error mapper for the account surface. Auth failures become 401/403,
 * caller mistakes keep their 4xx, anything else a logged 500 with `fallback`.
 * Error messages never reach the response.
 */
export function authError(error: unknown, request: Request, operation: string, fallback?: string): Response {
  return errorResponse(asEdgeError(error), { surface: "auth", operation, request }, fallback);
}
