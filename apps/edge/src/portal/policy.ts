/**
 * The portal's authorization policy, framework-free: OAuth resources and their
 * scope ceilings, the capabilities each session kind grants, and the one
 * `authorize` check. Ported from `apps/portal/src/server/bff/capabilities.ts`
 * and `packages/account/src/better-auth/oauth-policy.ts`; the two must agree
 * until the Vercel copies are deleted at cutover.
 */

export const AOMI_CANONICAL_USER_CLAIM = "https://aomi.dev/canonical_user_id";
export const AOMI_PRINCIPAL_CLASS_CLAIM = "https://aomi.dev/principal_class";
export const AOMI_OAUTH_BASE_PATH = "/api/auth";
export const OFFLINE_ACCESS_SCOPE = "offline_access";

const AGENT_SCOPES = [
  "agent:read",
  "agent:write",
  "agent:actions:resolve",
  "mcp:agent",
  "payments:submit",
  "custody:delegate",
] as const;
const PIPELINE_SCOPES = [
  "pipeline:catalog",
  "pipeline:execute",
  "mcp:pipeline",
  "payments:submit",
  "custody:delegate",
] as const;
const ACCOUNT_SCOPES = [
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
const AGENT_REST_SCOPES = AGENT_SCOPES.filter((scope) => scope !== "mcp:agent");
const PIPELINE_REST_SCOPES = PIPELINE_SCOPES.filter(
  (scope) => scope !== "mcp:pipeline",
);

export type ResourceKind =
  | "agentRest"
  | "pipelineRest"
  | "agentMcp"
  | "pipelineMcp"
  | "accountRest";

export type ResourcePolicy = {
  kind: ResourceKind;
  identifier: string;
  allowedScopes: readonly string[];
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

export function resourcePolicies(
  resources: Resources,
  dpopRequired: boolean,
): readonly ResourcePolicy[] {
  const base: Omit<ResourcePolicy, "grantableScopes">[] = [
    {
      kind: "agentRest",
      identifier: resources.agentRest,
      allowedScopes: AGENT_REST_SCOPES,
      guestScopes: [
        "agent:read",
        "agent:write",
        "agent:actions:resolve",
        OFFLINE_ACCESS_SCOPE,
      ],
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
      guestScopes: [
        "mcp:pipeline",
        "pipeline:catalog",
        "pipeline:execute",
        OFFLINE_ACCESS_SCOPE,
      ],
      dpopBoundAccessTokensRequired: dpopRequired,
    },
  ];
  return base.map((policy) => ({
    ...policy,
    grantableScopes: [...policy.allowedScopes, OFFLINE_ACCESS_SCOPE],
  }));
}

export function policyFor(
  resource: string,
  resources: Resources,
  dpopRequired: boolean,
): ResourcePolicy {
  const policy = resourcePolicies(resources, dpopRequired).find(
    (candidate) => candidate.identifier === resource,
  );
  if (!policy) throw new Error(`unknown protected resource ${resource}`);
  return policy;
}

/** What a caller may do. Granted by the credential, never by the endpoint. */
export type Capability =
  | "chat"
  | "actions"
  | "account"
  | "account_read"
  | "payments"
  | "custody"
  | "settings"
  | "safety_policy"
  | "managed_signing"
  | "backend_bearer"
  | "cli_session"
  | "device_login"
  | "mcp";

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
const GUEST: readonly Capability[] = [
  "chat",
  "actions",
  "account",
  "backend_bearer",
  "device_login",
];
// Any https site may embed the widget, so its sessions never get a raw backend
// token or mint CLI logins.
const EMBEDDED: readonly Capability[] = [
  "backend_bearer",
  "cli_session",
  "device_login",
];

/** Session-shaped principals; OAuth grants are the token's own scopes. */
export type SessionKind = "cookie" | "session_bearer" | "widget";

const GRANTS: Record<
  SessionKind,
  { user: readonly Capability[]; guest: readonly Capability[] }
> = {
  // Rotating a CLI session revokes the presented one, so a browser cookie may
  // not ask for it.
  cookie: {
    user: SIGNED_IN.filter((capability) => capability !== "cli_session"),
    guest: GUEST,
  },
  session_bearer: { user: SIGNED_IN, guest: GUEST },
  widget: {
    user: SIGNED_IN.filter((capability) => !EMBEDDED.includes(capability)),
    guest: GUEST.filter((capability) => !EMBEDDED.includes(capability)),
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

/** The scopes a session-shaped principal holds on a protected resource. */
export function sessionScopesOn(
  kind: SessionKind,
  guest: boolean,
  policy: ResourcePolicy,
): readonly string[] {
  const granted = capabilitiesOf(kind, guest);
  return policy.allowedScopes.filter((scope) => {
    const capability = SCOPE_CAPABILITY[scope];
    return capability !== undefined && granted.includes(capability);
  });
}

/** Reduce a guest grant to what the resource lets a guest carry. */
export function guestScopesFor(
  policy: ResourcePolicy,
  requested: readonly string[],
): string[] {
  const ceiling = new Set(policy.guestScopes);
  return requested.filter((scope) => ceiling.has(scope));
}

/** What a route needs: a capability, or scopes on a protected resource. */
export type Need =
  | { capability: Capability; anonymous?: true }
  | { resource: string; scopes: readonly string[] };

export const DELEGATING_SCOPES: readonly string[] = ["agent:write", "pipeline:execute"];
