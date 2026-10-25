import { UpstreamUnreachableError } from "./forward";
import { PrincipalError, PrincipalUpstreamError, protectedResourceMetadataUrl } from "./principal";

/** Signing a backend bearer failed: a server fault, never the caller's. */
export class BearerMintError extends Error {
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
  /** Scopes the challenge names instead of the ones the route required. */
  challengeScopes?: readonly string[];
  /** Answer in JSON-RPC error shape (MCP transports). */
  jsonRpc?: boolean;
};

function protectedResourceChallenge(
  error: PrincipalError,
  resource: string,
  shape: ErrorShape,
): Response {
  const headers = new Headers(error.challengeHeaders);
  if (!headers.has("www-authenticate")) {
    const metadata = `resource_metadata="${protectedResourceMetadataUrl(resource)}"`;
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

/**
 * The one error mapper. Auth failures become 401/403, an unreachable upstream
 * a 502, and anything else a 500 that names only the operation. Error messages
 * never reach the response.
 */
export function errorResponse(error: unknown, request: Request, shape: ErrorShape): Response {
  if (error instanceof PrincipalError) {
    if (shape.resource) return protectedResourceChallenge(error, shape.resource, shape);
    return Response.json(
      { error: error.code },
      { status: error.status, headers: error.challengeHeaders },
    );
  }
  if (error instanceof PrincipalUpstreamError) {
    console.error("edge.portal.principal_unavailable", {
      operation: shape.operation,
      method: request.method,
      cause: String((error.cause as Error | undefined)?.message ?? error.cause),
    });
    return Response.json({ error: "auth_unavailable" }, { status: 502 });
  }
  if (error instanceof BearerMintError) {
    console.error("edge.portal.bearer_mint_failed", {
      operation: shape.operation,
      cause: String((error.cause as Error | undefined)?.message ?? error.cause),
    });
    return Response.json({ error: "bearer_mint_failed" }, { status: 502 });
  }
  if (error instanceof UpstreamUnreachableError) {
    console.error("edge.portal.upstream_unreachable", {
      operation: shape.operation,
      cause: String((error.cause as Error | undefined)?.message ?? error.cause),
    });
    return Response.json({ error: "upstream_unavailable" }, { status: 502 });
  }
  console.error("edge.portal.internal_error", {
    operation: shape.operation,
    method: request.method,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  });
  return Response.json({ error: shape.fallback ?? "internal_error" }, { status: 500 });
}
