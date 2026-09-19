import { readAccountAuthEnv } from "./env";

export const AOMI_CANONICAL_USER_CLAIM =
  "https://aomi.dev/canonical_user_id" as const;
export const AOMI_PRINCIPAL_CLASS_CLAIM =
  "https://aomi.dev/principal_class" as const;

export const AOMI_OAUTH_BASE_PATH = "/api/auth" as const;

export const OFFLINE_ACCESS_SCOPE = "offline_access" as const;

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
  "account:credits:topup",
  "account:usage:read",
  "custody:delegate",
  "openid",
  "profile",
  "email",
  "offline_access",
] as const;

export const AGENT_SCOPES = [
  "agent:read",
  "agent:write",
  "agent:actions:resolve",
  "mcp:agent",
  "payments:submit",
  "custody:delegate",
] as const;
export const PIPELINE_SCOPES = [
  "pipeline:catalog",
  "pipeline:execute",
  "mcp:pipeline",
  "payments:submit",
  "custody:delegate",
] as const;
export const ACCOUNT_SCOPES = [
  "account:credits:read",
  "account:credits:topup",
  "account:usage:read",
  "payments:submit",
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

export const AGENT_REST_SCOPES = AGENT_SCOPES.filter(
  (scope) => scope !== "mcp:agent",
);
export const PIPELINE_REST_SCOPES = PIPELINE_SCOPES.filter(
  (scope) => scope !== "mcp:pipeline",
);

export type AomiOAuthResourceKind =
  | "agentRest"
  | "pipelineRest"
  | "agentMcp"
  | "pipelineMcp"
  | "accountRest";

export type AomiOAuthResourcePolicy = {
  kind: AomiOAuthResourceKind;
  identifier: string;
  /** The API capabilities this resource exposes, and the ceiling on what an
   * authenticated principal may DO with a grant for it. */
  allowedScopes: readonly string[];
  /**
   * Everything a grant for this resource may CARRY: `allowedScopes` plus
   * `offline_access`. A client builds its authorization request out of what
   * the resource advertises, so advertising only the capabilities got the
   * server asked for exactly those, issued no refresh token, and left every
   * session dead one access-token lifetime later with nothing to refresh.
   * This is the set to advertise, to seed the resource row with, and to
   * narrow a request down to.
   */
  grantableScopes: readonly string[];
  guestScopes: readonly string[];
  dpopBoundAccessTokensRequired: boolean;
};

type AomiOAuthResourceCapabilities = Omit<
  AomiOAuthResourcePolicy,
  "grantableScopes"
>;

export function isMcpDpopRequired(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.AOMI_MCP_DPOP_REQUIRED?.trim().toLowerCase() === "true";
}

export function aomiOAuthResources(
  env: Record<string, string | undefined> = process.env,
) {
  const portalOrigin = new URL(readAccountAuthEnv(env).betterAuthUrl).origin;
  const authorizationServerIssuer = `${portalOrigin}${AOMI_OAUTH_BASE_PATH}`;
  return {
    portalOrigin,
    authorizationServerIssuer,
    agentMcp: `${portalOrigin}/v1/agent/mcp`,
    pipelineMcp: `${portalOrigin}/v1/pipeline/mcp`,
    agentRest: `${portalOrigin}/v1/agent`,
    pipelineRest: `${portalOrigin}/v1/pipeline`,
    accountRest: `${portalOrigin}/v1/account`,
  } as const;
}

export function aomiOAuthResourcePolicies(
  env: Record<string, string | undefined> = process.env,
): readonly AomiOAuthResourcePolicy[] {
  const resources = aomiOAuthResources(env);
  const dpopRequired = isMcpDpopRequired(env);
  const capabilities: readonly AomiOAuthResourceCapabilities[] = [
    {
      kind: "agentRest",
      identifier: resources.agentRest,
      allowedScopes: AGENT_REST_SCOPES,
      guestScopes: [
        "agent:read",
        "agent:write",
        "agent:actions:resolve",
        "offline_access",
      ],
      dpopBoundAccessTokensRequired: false,
    },
    {
      kind: "pipelineRest",
      identifier: resources.pipelineRest,
      allowedScopes: PIPELINE_REST_SCOPES,
      guestScopes: ["pipeline:catalog", "pipeline:execute", "offline_access"],
      dpopBoundAccessTokensRequired: false,
    },
    {
      kind: "accountRest",
      identifier: resources.accountRest,
      allowedScopes: ACCOUNT_SCOPES,
      guestScopes: [],
      dpopBoundAccessTokensRequired: false,
    },
    {
      kind: "agentMcp",
      identifier: resources.agentMcp,
      allowedScopes: AGENT_SCOPES,
      guestScopes: ["mcp:agent", "agent:read", "agent:write", "offline_access"],
      dpopBoundAccessTokensRequired: dpopRequired,
    },
    {
      kind: "pipelineMcp",
      identifier: resources.pipelineMcp,
      allowedScopes: PIPELINE_SCOPES,
      guestScopes: [
        "mcp:pipeline",
        "pipeline:catalog",
        "pipeline:execute",
        "offline_access",
      ],
      dpopBoundAccessTokensRequired: dpopRequired,
    },
  ];
  return capabilities.map((policy) => ({
    ...policy,
    grantableScopes: [...policy.allowedScopes, OFFLINE_ACCESS_SCOPE],
  }));
}

export function aomiOAuthResourcePolicy(
  resource: string,
  env: Record<string, string | undefined> = process.env,
): AomiOAuthResourcePolicy | null {
  return (
    aomiOAuthResourcePolicies(env).find(
      (policy) => policy.identifier === resource,
    ) ?? null
  );
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
