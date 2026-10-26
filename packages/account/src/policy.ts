/**
 * The account authorization policy, framework-free so every enforcement point
 * reads one copy: the OAuth resources a portal origin hosts and their scope
 * ceilings, the capabilities each session kind grants, and the one
 * `authorize` check. The Better Auth server, the portal BFF and the edge
 * Worker all build on it.
 */

export const AOMI_CANONICAL_USER_CLAIM = "https://aomi.dev/canonical_user_id" as const;
export const AOMI_PRINCIPAL_CLASS_CLAIM = "https://aomi.dev/principal_class" as const;
export const AOMI_OAUTH_BASE_PATH = "/api/auth" as const;
export const OFFLINE_ACCESS_SCOPE = "offline_access" as const;

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
  "account:credits:fund",
  "account:usage:read",
  "account:transaction-safety:read",
  "account:transaction-safety:write",
  "account:apps:read",
  "account:apps:write",
  "account:credentials:read",
  "account:credentials:write",
  "payments:submit",
] as const;
export const AGENT_REST_SCOPES = AGENT_SCOPES.filter((scope) => scope !== "mcp:agent");
export const PIPELINE_REST_SCOPES = PIPELINE_SCOPES.filter((scope) => scope !== "mcp:pipeline");

export type ResourceKind = "agentRest" | "pipelineRest" | "agentMcp" | "pipelineMcp" | "accountRest";

export type ResourcePolicy = {
  kind: ResourceKind;
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

/** The OAuth resources one portal origin hosts, by identifier. */
export type Resources = {
  portalOrigin: string;
  authorizationServerIssuer: string;
  agentMcp: string;
  pipelineMcp: string;
  agentRest: string;
  pipelineRest: string;
  accountRest: string;
};

export function resourcesFor(portalOrigin: string): Resources {
  return {
    portalOrigin,
    authorizationServerIssuer: `${portalOrigin}${AOMI_OAUTH_BASE_PATH}`,
    agentMcp: `${portalOrigin}/v1/agent/mcp`,
    pipelineMcp: `${portalOrigin}/v1/pipeline/mcp`,
    agentRest: `${portalOrigin}/v1/agent`,
    pipelineRest: `${portalOrigin}/v1/pipeline`,
    accountRest: `${portalOrigin}/v1/account`,
  };
}

export function resourcePolicies(resources: Resources, dpopRequired: boolean): readonly ResourcePolicy[] {
  const base: Omit<ResourcePolicy, "grantableScopes">[] = [
    {
      kind: "agentRest",
      identifier: resources.agentRest,
      allowedScopes: AGENT_REST_SCOPES,
      guestScopes: ["agent:read", "agent:write", "agent:actions:resolve", OFFLINE_ACCESS_SCOPE],
      dpopBoundAccessTokensRequired: false,
    },
    {
      kind: "pipelineRest",
      identifier: resources.pipelineRest,
      allowedScopes: PIPELINE_REST_SCOPES,
      guestScopes: ["pipeline:catalog", "pipeline:execute", OFFLINE_ACCESS_SCOPE],
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
      guestScopes: ["mcp:agent", "agent:read", "agent:write", OFFLINE_ACCESS_SCOPE],
      dpopBoundAccessTokensRequired: dpopRequired,
    },
    {
      kind: "pipelineMcp",
      identifier: resources.pipelineMcp,
      allowedScopes: PIPELINE_SCOPES,
      guestScopes: ["mcp:pipeline", "pipeline:catalog", "pipeline:execute", OFFLINE_ACCESS_SCOPE],
      dpopBoundAccessTokensRequired: dpopRequired,
    },
  ];
  return base.map((policy) => ({ ...policy, grantableScopes: [...policy.allowedScopes, OFFLINE_ACCESS_SCOPE] }));
}

/** Reduce a guest grant to what the resource lets a guest carry. */
export function guestScopesFor(policy: ResourcePolicy, requested: readonly string[]): string[] {
  const ceiling = new Set(policy.guestScopes);
  return requested.filter((scope) => ceiling.has(scope));
}

/** What a caller may do. Granted by the credential, never by the endpoint. */
export type Capability =
  | "chat" // threads, turns, catalogs, simulations
  | "actions" // resolve staged actions and commits
  | "account" // own profile, identities, wallets, provider links, deactivation
  | "account_read" // credits and usage statement
  | "payments" // top-ups and payment signatures
  | "custody" // delegated custody
  | "settings" // installed apps, app secrets, BYOK keys
  | "safety_policy" // account and thread transaction safety
  | "managed_signing" // execution profile, AA accounts, signing requests
  | "backend_bearer" // a raw 15-minute backend token
  | "cli_session" // a separate one-day CLI session
  | "device_login" // grant a CLI device login
  | "mcp"; // MCP transport, OAuth grants only

const SIGNED_IN: readonly Capability[] = [
  "chat",
  "actions",
  "account",
  "account_read",
  "payments",
  "custody",
  "settings",
  "safety_policy",
  "managed_signing",
  "backend_bearer",
  "cli_session",
  "device_login",
];
const GUEST: readonly Capability[] = ["chat", "actions", "account", "backend_bearer", "device_login"];
// Any https site may embed the widget, so its sessions never get a raw backend
// token or mint CLI logins.
const EMBEDDED: readonly Capability[] = ["backend_bearer", "cli_session", "device_login"];

/** Session-shaped principals; OAuth grants are the token's own scopes. */
export type SessionKind = "cookie" | "session_bearer" | "widget" | "e2e";

const GRANTS: Record<SessionKind, { user: readonly Capability[]; guest: readonly Capability[] }> = {
  // Rotating a CLI session revokes the presented one, so a browser cookie may
  // not ask for it.
  cookie: { user: SIGNED_IN.filter((capability) => capability !== "cli_session"), guest: GUEST },
  session_bearer: { user: SIGNED_IN, guest: GUEST },
  widget: {
    user: SIGNED_IN.filter((capability) => !EMBEDDED.includes(capability)),
    guest: GUEST.filter((capability) => !EMBEDDED.includes(capability)),
  },
  // The portal's local E2E stand-in only ever served the proxied APIs.
  e2e: {
    user: SIGNED_IN.filter((capability) => !["account", "cli_session", "device_login"].includes(capability)),
    guest: [],
  },
};

const SCOPE_CAPABILITY: Record<string, Capability> = {
  "agent:read": "chat",
  "agent:write": "chat",
  "pipeline:catalog": "chat",
  "pipeline:execute": "chat",
  "agent:actions:resolve": "actions",
  "payments:submit": "payments",
  "account:credits:fund": "payments",
  "custody:delegate": "custody",
  "account:credits:read": "account_read",
  "account:usage:read": "account_read",
  "account:transaction-safety:read": "safety_policy",
  "account:transaction-safety:write": "safety_policy",
  "account:apps:read": "settings",
  "account:apps:write": "settings",
  "account:credentials:read": "settings",
  "account:credentials:write": "settings",
  "mcp:agent": "mcp",
  "mcp:pipeline": "mcp",
};

export function capabilitiesOf(kind: SessionKind, guest: boolean): readonly Capability[] {
  const grants = GRANTS[kind];
  return guest ? grants.guest : grants.user;
}

export function capabilityOfScope(scope: string): Capability | undefined {
  return SCOPE_CAPABILITY[scope];
}

/** The caller as the policy sees it. */
export type PolicyPrincipal =
  | { kind: "none" }
  | { kind: "oauth"; scopes: readonly string[] }
  | { kind: SessionKind; guest: boolean };

/** The scopes a principal holds on a protected resource. */
export function scopesOn(principal: Exclude<PolicyPrincipal, { kind: "none" }>, policy: ResourcePolicy): readonly string[] {
  if (principal.kind === "oauth") return principal.scopes;
  const granted = capabilitiesOf(principal.kind, principal.guest);
  return policy.allowedScopes.filter((scope) => {
    const capability = capabilityOfScope(scope);
    return capability !== undefined && granted.includes(capability);
  });
}

/** What a route needs: a capability, or scopes on a protected resource. */
export type Need = { capability: Capability; anonymous?: true } | { resource: string; scopes: readonly string[] };

/** A grant for one of these also carries `custody:delegate` when the caller holds it. */
const DELEGATING_SCOPES: readonly string[] = ["agent:write", "pipeline:execute"];

export type Denial = {
  status: 401 | 403;
  code: "unauthenticated" | "invalid_token" | "insufficient_scope";
  requiredScopes?: readonly string[];
};

/**
 * The one permission check: the scopes to mint for a protected resource
 * (empty for a capability route), or why the caller is refused.
 */
export function authorize(
  principal: PolicyPrincipal,
  need: Need,
  policyFor: (resource: string) => ResourcePolicy,
): { scopes: string[] } | { denied: Denial } {
  if (principal.kind === "none") {
    return "capability" in need && need.anonymous
      ? { scopes: [] }
      : { denied: { status: 401, code: "unauthenticated" } };
  }
  if ("capability" in need) {
    if (principal.kind === "oauth") return { denied: { status: 401, code: "invalid_token" } };
    return capabilitiesOf(principal.kind, principal.guest).includes(need.capability)
      ? { scopes: [] }
      : { denied: { status: 403, code: "insufficient_scope" } };
  }
  const held = scopesOn(principal, policyFor(need.resource));
  if (need.scopes.some((scope) => !held.includes(scope))) {
    return { denied: { status: 403, code: "insufficient_scope", requiredScopes: need.scopes } };
  }
  const scopes = [...new Set(need.scopes)];
  if (need.scopes.some((scope) => DELEGATING_SCOPES.includes(scope)) && held.includes("custody:delegate")) {
    scopes.push("custody:delegate");
  }
  return { scopes };
}
