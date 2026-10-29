import { errorResponse } from "../kernel/errors";
import { PrincipalError, protectedResourceMetadataUrl } from "./principal";

/** How an OAuth protected resource (agent, pipeline, account APIs, MCP) answers. */
export type ResourceShape = {
  resource: string;
  /** Scopes the challenge names instead of the ones the route required. */
  challengeScopes?: readonly string[];
  /** Answer in JSON-RPC error shape (MCP transports). */
  jsonRpc?: boolean;
};

/** RFC 6750: an auth failure on a protected resource carries a Bearer challenge. */
function challenge(error: PrincipalError, shape: ResourceShape): Response {
  const headers = new Headers(error.headers);
  if (!headers.has("www-authenticate")) {
    const metadata = `resource_metadata="${protectedResourceMetadataUrl(shape.resource)}"`;
    const scopes = shape.challengeScopes ?? error.requiredScopes;
    const scope = scopes.length ? `, scope="${[...new Set(scopes)].join(" ")}"` : "";
    headers.set(
      "www-authenticate",
      error.status === 403
        ? `Bearer error="insufficient_scope"${scope}, ${metadata}`
        : `Bearer error="${error.code === "insufficient_scope" ? "insufficient_scope" : "invalid_token"}", ${metadata}${scope}`,
    );
  }
  headers.set("content-type", "application/json");
  const body = shape.jsonRpc
    ? { jsonrpc: "2.0", error: { code: -32000, message: error.code }, id: null }
    : { error: { code: error.code, message: error.code } };
  return new Response(JSON.stringify(body), { status: error.status, headers });
}

export function portalError(
  error: unknown,
  request: Request,
  operation: string,
  shape?: ResourceShape,
  fallback?: string,
): Response {
  if (shape && error instanceof PrincipalError) return challenge(error, shape);
  return errorResponse(error, { surface: "portal", operation, request }, fallback);
}
