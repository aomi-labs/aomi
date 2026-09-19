import type { ApiPrincipal } from "./principal";
import { ApiPrincipalError } from "./principal";
import { aomiOAuthResourcePolicy, type AomiPublicResource } from "./resources";

/**
 * Downscope an MCP assertion to scopes authorized for its exact resource.
 * Rust remains the sole authority that maps a tools/call name to a business
 * scope; Portal deliberately does not inspect or classify the MCP body.
 */
export function downscopeMcpPrincipal(
  request: Request,
  principal: ApiPrincipal,
  resource: AomiPublicResource,
  transportScope: "mcp:agent" | "mcp:pipeline",
): ApiPrincipal {
  if (principal.resource !== resource) {
    throw new ApiPrincipalError(401, "invalid_token");
  }
  const policy = aomiOAuthResourcePolicy(resource);
  if (!policy) throw new ApiPrincipalError(401, "invalid_token");

  const allowed = new Set<string>(policy.allowedScopes);
  const scopes = principal.scopes.filter((scope) => allowed.has(scope));
  const required = [
    transportScope,
    ...(request.headers.has("payment-signature") ? ["payments:submit"] : []),
  ];
  for (const scope of required) {
    if (!scopes.includes(scope)) {
      throw new ApiPrincipalError(403, "insufficient_scope", required);
    }
  }
  return { ...principal, scopes };
}
