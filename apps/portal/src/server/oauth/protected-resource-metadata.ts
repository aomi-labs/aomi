import { auth } from "@/server/auth";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";

import { publicRead } from "@/server/bff/cors";
import {
  aomiOAuthResourcePolicies,
  aomiOAuthResourcePolicy,
  aomiOAuthResources,
} from "@aomi-labs/account/better-auth/core";

const client = oauthProviderResourceClient(auth).getActions();

/** RFC 9728 metadata for the agent MCP resource, served at the bare well-known path. */
export async function agentMcpResourceMetadata(): Promise<Response> {
  return metadataFor(aomiOAuthResourcePolicy(aomiOAuthResources().agentMcp));
}

/** RFC 9728 metadata for the resource whose pathname follows the well-known prefix. */
export async function resourceMetadata(splat: string | undefined): Promise<Response> {
  const path = `/${(splat?.split("/").filter(Boolean) ?? []).join("/")}`;
  return metadataFor(
    aomiOAuthResourcePolicies().find(
      (candidate) => new URL(candidate.identifier).pathname === path,
    ),
  );
}

/** HEAD answers with GET's status and headers. */
export function withoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}

export function metadataPreflight(): Response {
  return publicRead.apply(new Response(null, { status: 204 }));
}

async function metadataFor(
  policy: ReturnType<typeof aomiOAuthResourcePolicy> | undefined,
): Promise<Response> {
  if (!policy) return Response.json({ error: "not_found" }, { status: 404 });
  return publicRead.apply(
    Response.json(
      await client.getProtectedResourceMetadata({
        resource: policy.identifier,
        authorization_servers: [aomiOAuthResources().authorizationServerIssuer],
        scopes_supported: [...policy.grantableScopes],
        dpop_bound_access_tokens_required: policy.dpopBoundAccessTokensRequired,
        dpop_signing_alg_values_supported: ["ES256", "EdDSA"],
      }),
    ),
  );
}
