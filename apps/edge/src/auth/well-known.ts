import { aomiOAuthResourcePolicy } from "@aomi-labs/account/better-auth";
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";

import { config } from "../kernel/config";
import { preflight, publicRead, withCors } from "../kernel/cors";
import type { PortalContext } from "../portal/context";

const AUTHORIZATION_SERVER = /^\/\.well-known\/oauth-authorization-server(?:\/api\/auth)?$/;
const PROTECTED_RESOURCE = /^\/\.well-known\/oauth-protected-resource(\/.*)?$/;

export function isOAuthDiscovery(pathname: string): boolean {
  return AUTHORIZATION_SERVER.test(pathname) || PROTECTED_RESOURCE.test(pathname);
}

/** The OAuth discovery documents: anyone may read them, without credentials. */
export async function oauthDiscovery(request: Request, ctx: PortalContext): Promise<Response> {
  const cfg = config(ctx.env);
  if (request.method === "OPTIONS") return preflight(publicRead(), request, cfg);
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD, OPTIONS" } });
  const response = await document(request, ctx);
  const body = request.method === "HEAD" ? null : response.body;
  return withCors(publicRead(), request, new Response(body, response), cfg);
}

async function document(request: Request, ctx: PortalContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  const auth = ctx.auth();
  if (AUTHORIZATION_SERVER.test(pathname)) {
    const metadata = oauthProviderAuthServerMetadata(auth as unknown as Parameters<typeof oauthProviderAuthServerMetadata>[0]);
    return codexCompatibleMetadata(await metadata(new Request(request.url)));
  }
  // The root names the agent MCP; a path names that resource, app-locked MCP paths included.
  const path = PROTECTED_RESOURCE.exec(pathname)?.[1];
  const policy = aomiOAuthResourcePolicy(path ? `${ctx.resources.portalOrigin}${path}` : ctx.resources.agentMcp);
  if (!policy) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(
    await oauthProviderResourceClient(auth).getActions().getProtectedResourceMetadata({
      resource: policy.identifier,
      authorization_servers: [ctx.resources.authorizationServerIssuer],
      scopes_supported: [...policy.grantableScopes],
      dpop_bound_access_tokens_required: policy.dpopBoundAccessTokensRequired,
      dpop_signing_alg_values_supported: ["ES256", "EdDSA"],
    }),
  );
}

async function codexCompatibleMetadata(response: Response): Promise<Response> {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as Record<string, unknown> | null;
  if (body?.authorization_response_iss_parameter_supported !== true) return response;
  // Codex CLI 0.144 discards the RFC 9207 `iss` callback parameter but then
  // requires it when this capability is advertised. Keep emitting `iss` on
  // authorization responses; temporarily advertise it as optional so Codex
  // can finish the PKCE flow. Remove this compatibility path once Codex
  // forwards the callback issuer to its OAuth client.
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json(
    { ...body, authorization_response_iss_parameter_supported: false },
    { status: response.status, statusText: response.statusText, headers },
  );
}
