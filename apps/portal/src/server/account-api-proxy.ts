import "server-only";

import { mintAgentApiBearer } from "@aomi-labs/account";
import { configuredAgentApiUrl } from "@portal/server/agent-api-proxy";
import type { ApiPrincipal } from "@portal/server/oauth/principal";

const ACCOUNT_PATHS = new Set([
  "/v1/account/credits",
  "/v1/account/credits/top-up",
  "/v1/account/statement",
]);

const REQUEST_HEADERS = new Set([
  "accept",
  "content-type",
  "idempotency-key",
  "payment-signature",
  "x-request-id",
]);

const RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-type",
  "payment-required",
  "payment-receipt",
  "payment-response",
  "retry-after",
  "x-request-id",
]);

/** Authenticated BFF -> api-server proxy limited to Credit Bank endpoints. */
export async function proxyAccountApi(
  request: Request,
  principal: ApiPrincipal,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const incoming = new URL(request.url);
  if (!ACCOUNT_PATHS.has(incoming.pathname)) {
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
    duplex: "half",
  } as RequestInit & { duplex: "half" });

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
