import "server-only";

import { mintAgentApiBearer } from "@aomi-labs/account";
import type { ApiPrincipal } from "@portal/server/oauth/principal";

const REQUEST_HEADERS = new Set([
  "accept",
  "aomi-app-key",
  "content-type",
  "idempotency-key",
  "mcp-protocol-version",
  "payment-signature",
  "x-request-id",
  "x-aomi-inference-funding",
]);

const RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-type",
  "mcp-protocol-version",
  "payment-required",
  "payment-receipt",
  "payment-response",
  "retry-after",
  "x-request-id",
]);

export function configuredAgentApiUrl(): string {
  const configured = process.env.AOMI_AGENT_API_URL?.trim();
  if (configured) return absoluteOrigin(configured, "AOMI_AGENT_API_URL");
  if (
    process.env.VERCEL_ENV === "preview" ||
    process.env.VERCEL_ENV === "production"
  ) {
    throw new Error("AOMI_AGENT_API_URL is required in hosted environments");
  }
  return "http://127.0.0.1:8082";
}

/**
 * Authenticated BFF -> api-server proxy. It intentionally has no Agent or
 * Pipeline DTO, cursor, action, catalog, or MCP knowledge: the Rust process
 * owns the public protocol.
 */
export async function proxyAgentApi(
  request: Request,
  principal: ApiPrincipal,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const incoming = new URL(request.url);
  if (
    incoming.pathname !== "/v1/agent" &&
    !incoming.pathname.startsWith("/v1/agent/") &&
    incoming.pathname !== "/v1/pipeline" &&
    !incoming.pathname.startsWith("/v1/pipeline/")
  ) {
    return Response.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404 },
    );
  }
  const upstream = new URL(
    `${incoming.pathname}${incoming.search}`,
    configuredAgentApiUrl(),
  );
  const { bearer } = await mintAgentApiBearer(principal.canonicalUserId, {
    scope: principal.scopes.join(" "),
    resource: principal.resource,
    client_id: principal.clientId,
    auth_source: principal.authSource,
    principal_class: principal.principalClass,
    grant_id: principal.grantId,
    // A raw Better Auth session token must never be copied into an internal
    // assertion. Use a non-secret bounded correlation marker instead.
    sid: principal.sid ? "session-bound" : undefined,
  });
  const headers = allowlisted(request.headers, REQUEST_HEADERS);
  headers.set("authorization", `Bearer ${bearer}`);
  const response = await fetchImpl(upstream, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    cache: "no-store",
    redirect: "manual",
    // Node fetch requires this for a streamed Request body.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return new Response(response.body, {
    status: response.status,
    headers: allowlisted(response.headers, RESPONSE_HEADERS),
  });
}

const DISCOVERY_PATHS = new Set(["/openapi.json", "/.well-known/api-catalog"]);
const DISCOVERY_REQUEST_HEADERS = new Set(["accept", "x-request-id"]);

/** Public read-only discovery proxy for the api-server contract. */
export async function proxyAgentApiDiscovery(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const incoming = new URL(request.url);
  if (request.method !== "GET" || !DISCOVERY_PATHS.has(incoming.pathname)) {
    return Response.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404 },
    );
  }
  const upstream = new URL(
    `${incoming.pathname}${incoming.search}`,
    configuredAgentApiUrl(),
  );
  const response = await fetchImpl(upstream, {
    method: "GET",
    headers: allowlisted(request.headers, DISCOVERY_REQUEST_HEADERS),
    cache: "no-store",
    redirect: "manual",
  });
  return new Response(response.body, {
    status: response.status,
    headers: allowlisted(response.headers, RESPONSE_HEADERS),
  });
}

function allowlisted(source: Headers, allowed: ReadonlySet<string>): Headers {
  const headers = new Headers();
  source.forEach((value, name) => {
    if (allowed.has(name.toLowerCase())) headers.set(name, value);
  });
  return headers;
}

function absoluteOrigin(value: string, name: string): string {
  try {
    const url = new URL(value);
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
}
