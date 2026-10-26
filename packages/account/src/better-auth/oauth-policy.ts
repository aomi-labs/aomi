import {
  acceptsApiToken,
  AGENT_SCOPES,
  appMcpName as appMcpNameOn,
  appMcpResource as appMcpResourceOn,
  OFFLINE_ACCESS_SCOPE,
  resourcePolicies,
  resourcePolicy,
  resourcesFor,
  type ResourceKind,
  type ResourcePolicy,
} from "../policy";
import { readAccountAuthEnv } from "./env";

export {
  ACCOUNT_SCOPES,
  AGENT_REST_SCOPES,
  AGENT_SCOPES,
  AOMI_CANONICAL_USER_CLAIM,
  AOMI_OAUTH_BASE_PATH,
  AOMI_PRINCIPAL_CLASS_CLAIM,
  OFFLINE_ACCESS_SCOPE,
  PIPELINE_REST_SCOPES,
  PIPELINE_SCOPES,
} from "../policy";

export const AOMI_SCOPES = [
  "agent:read",
  "agent:write",
  "agent:actions:resolve",
  "pipeline:catalog",
  "pipeline:execute",
  "mcp:agent",
  "mcp:pipeline",
  "payments:submit",
  "account:credits:read",
  "account:credits:fund",
  "account:usage:read",
  "account:transaction-safety:read",
  "account:transaction-safety:write",
  "account:apps:read",
  "account:apps:write",
  "account:credentials:read",
  "account:credentials:write",
  "openid",
  "profile",
  "email",
  "offline_access",
] as const;

/**
 * What a dynamically registered client is granted when it asks for nothing.
 * Agent MCP is the documented primary path, and this set must stay valid for
 * that one resource on its own, which a test pins.
 *
 * It does not constrain what a client may later request: MCP clients build
 * their scope request from the authorization server's `scopes_supported`, and
 * that request is narrowed to the resource it names at authorize — see
 * `narrowScopesForAomiResource`.
 */
export const MCP_CLIENT_REGISTRATION_SCOPES = [
  ...AGENT_SCOPES,
  OFFLINE_ACCESS_SCOPE,
] as const;

export type AomiOAuthResourceKind = ResourceKind;
export type AomiOAuthResourcePolicy = ResourcePolicy;

export function isMcpDpopRequired(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.AOMI_MCP_DPOP_REQUIRED?.trim().toLowerCase() === "true";
}

export function aomiOAuthResources(
  env: Record<string, string | undefined> = process.env,
) {
  return resourcesFor(new URL(readAccountAuthEnv(env).betterAuthUrl).origin);
}

export function aomiOAuthResourcePolicies(
  env: Record<string, string | undefined> = process.env,
): readonly AomiOAuthResourcePolicy[] {
  return resourcePolicies(aomiOAuthResources(env), isMcpDpopRequired(env));
}

/** The fixed resources, and every app-locked MCP path (`/v1/apps/<app>/mcp`). */
export function aomiOAuthResourcePolicy(
  resource: string,
  env: Record<string, string | undefined> = process.env,
): AomiOAuthResourcePolicy | null {
  return resourcePolicy(aomiOAuthResources(env), isMcpDpopRequired(env), resource);
}

/**
 * The resources a token for `/v1` (the one CLI and SDK sign-in) also opens:
 * the three REST APIs. MCP servers only take their own exact token.
 */
export function acceptsAomiApiToken(
  resource: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const policy = aomiOAuthResourcePolicy(resource, env);
  return policy !== null && acceptsApiToken(policy);
}

/** The MCP resource locked to one app: the agent MCP with that app forced. */
export function appMcpResource(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return appMcpResourceOn(aomiOAuthResources(env), name);
}

/** The app an app-locked MCP resource names; undefined for any other resource. */
export function appMcpName(
  resource: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return appMcpNameOn(aomiOAuthResources(env), resource);
}

export function guestScopesForAomiResource(
  resource: string,
  requestedScopes: readonly string[],
  env: Record<string, string | undefined> = process.env,
): string[] {
  const policy = aomiOAuthResourcePolicy(resource, env);
  if (!policy) return [];
  const ceiling = new Set(policy.guestScopes);
  return requestedScopes.filter((scope) => ceiling.has(scope));
}

/**
 * Reduce a requested scope set to what this resource actually permits.
 *
 * MCP clients derive their scope request from the authorization server's
 * `scopes_supported`, which spans every resource this server hosts, so a client
 * targeting one resource still asks for all of them. RFC 6749 §3.3 allows the
 * authorization server to grant a narrower scope than requested; doing so is
 * what lets those clients complete a login without ever widening a grant.
 *
 * Returns an empty array when nothing requested is usable, which callers should
 * treat as invalid_scope rather than as an unscoped grant.
 */
export function narrowScopesForAomiResource(
  resource: string,
  requestedScopes: readonly string[],
  env: Record<string, string | undefined> = process.env,
): string[] {
  const policy = aomiOAuthResourcePolicy(resource, env);
  if (!policy) return [];
  const allowed = new Set(policy.grantableScopes);
  return [...new Set(requestedScopes)].filter((scope) => allowed.has(scope));
}

export function validateAomiResourceScopes(
  resource: string,
  requestedScopes: readonly string[],
  env: Record<string, string | undefined> = process.env,
):
  | { ok: true; policy: AomiOAuthResourcePolicy }
  | {
      ok: false;
      error: "invalid_target" | "invalid_scope" | "invalid_request";
    } {
  const policy = aomiOAuthResourcePolicy(resource, env);
  if (!policy) return { ok: false, error: "invalid_target" };
  const unique = new Set(requestedScopes);
  if (unique.size !== requestedScopes.length) {
    return { ok: false, error: "invalid_request" };
  }
  const forbiddenOidc = ["openid", "profile", "email"].some((scope) =>
    unique.has(scope),
  );
  if (forbiddenOidc) return { ok: false, error: "invalid_scope" };
  const allowed = new Set(policy.grantableScopes);
  if (requestedScopes.some((scope) => !allowed.has(scope))) {
    return { ok: false, error: "invalid_scope" };
  }
  return { ok: true, policy };
}
