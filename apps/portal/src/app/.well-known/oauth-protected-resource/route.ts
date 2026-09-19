import { auth } from "@aomi-labs/account/better-auth";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";

import { publicDiscoveryResponse } from "@portal/server/oauth/cors";
import {
  aomiOAuthResourcePolicy,
  aomiOAuthResources,
} from "@portal/server/oauth/resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const resources = aomiOAuthResources();
  const policy = aomiOAuthResourcePolicy(resources.agentMcp);
  if (!policy) return Response.json({ error: "not_found" }, { status: 404 });
  return publicDiscoveryResponse(
    Response.json(
      await oauthProviderResourceClient(auth)
        .getActions()
        .getProtectedResourceMetadata({
          resource: policy.identifier,
          authorization_servers: [resources.authorizationServerIssuer],
          scopes_supported: [...policy.grantableScopes],
          dpop_bound_access_tokens_required:
            policy.dpopBoundAccessTokensRequired,
          dpop_signing_alg_values_supported: ["ES256", "EdDSA"],
        }),
    ),
  );
}

export async function HEAD() {
  const response = await GET();
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}

export function OPTIONS() {
  return publicDiscoveryResponse(new Response(null, { status: 204 }));
}
