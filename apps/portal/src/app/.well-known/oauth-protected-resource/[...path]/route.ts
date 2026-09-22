import { auth } from "@aomi-labs/account/better-auth";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";

import { publicDiscoveryResponse } from "@portal/server/oauth/cors";
import {
  aomiOAuthResourcePolicies,
  aomiOAuthResources,
} from "@portal/server/oauth/resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const client = oauthProviderResourceClient(auth).getActions();

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = `/${(await context.params).path.join("/")}`;
  const resources = aomiOAuthResources();
  const policy = aomiOAuthResourcePolicies().find(
    (candidate) => new URL(candidate.identifier).pathname === path,
  );
  if (!policy) return Response.json({ error: "not_found" }, { status: 404 });
  return publicDiscoveryResponse(
    Response.json(
      await client.getProtectedResourceMetadata({
        resource: policy.identifier,
        authorization_servers: [resources.authorizationServerIssuer],
        scopes_supported: [...policy.grantableScopes],
        dpop_bound_access_tokens_required: policy.dpopBoundAccessTokensRequired,
        dpop_signing_alg_values_supported: ["ES256", "EdDSA"],
      }),
    ),
  );
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const response = await GET(request, context);
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}

export function OPTIONS() {
  return publicDiscoveryResponse(new Response(null, { status: 204 }));
}
