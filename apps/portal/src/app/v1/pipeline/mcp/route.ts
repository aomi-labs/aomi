import { auth } from "@aomi-labs/account/better-auth";
import { requireMcpAuth } from "@better-auth/mcp";

import { proxyAgentApi } from "@portal/server/agent-api-proxy";
import {
  apiAuthError,
  principalFromOAuthClaims,
} from "@portal/server/oauth/principal";
import { aomiOAuthResources } from "@portal/server/oauth/resources";
import { downscopeMcpPrincipal } from "@portal/server/oauth/mcp-principal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const resource = aomiOAuthResources().pipelineMcp;

const authenticatedPost = requireMcpAuth(
  auth,
  async (request, claims) => {
    try {
      const principal = downscopeMcpPrincipal(
        request,
        await principalFromOAuthClaims(claims, resource),
        resource,
        "mcp:pipeline",
      );
      const url = new URL(request.url);
      url.pathname = "/v1/pipeline/mcp";
      return proxyAgentApi(
        new Request(url, {
          method: request.method,
          headers: request.headers,
          body: await request.arrayBuffer(),
        }),
        principal,
      );
    } catch (error) {
      return apiAuthError(error, resource);
    }
  },
  {
    resource,
    requiredScopes: ["mcp:pipeline"],
    // The challenge is what a client re-authorizes with, so it must name
    // `offline_access`; without it the next grant carries no refresh token and
    // expires for good one access-token lifetime later.
    challengeScopes: ["mcp:pipeline", "pipeline:catalog", "offline_access"],
    dpop: { signingAlgorithms: ["ES256", "EdDSA"] },
  },
);

export const POST = authenticatedPost;
