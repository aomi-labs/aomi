/**
 * The account authorization policy, framework-free so every enforcement point
 * reads one copy: the OAuth resources a portal origin hosts and their scope
 * ceilings, the capabilities each session kind grants, the one `authorize`
 * check, and `ROUTES`, the one table of what each portal-host route needs.
 * Better Auth and the edge build on it; the SDK gets a generated copy
 * (`packages/client/src/generated/route-scopes.ts`).
 */

export const AOMI_CANONICAL_USER_CLAIM =
  "https://aomi.dev/canonical_user_id" as const;
export const AOMI_PRINCIPAL_CLASS_CLAIM =
  "https://aomi.dev/principal_class" as const;
export const AOMI_OAUTH_BASE_PATH = "/api/auth" as const;
export const OFFLINE_ACCESS_SCOPE = "offline_access" as const;

export const AGENT_SCOPES = [
  "agent:read",
  "agent:write",
  "agent:actions:resolve",
  "mcp:agent",
  "payments:submit",
] as const;
export const PIPELINE_SCOPES = [
  "pipeline:catalog",
  "pipeline:execute",
  "mcp:pipeline",
  "payments:submit",
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
export const AGENT_REST_SCOPES = AGENT_SCOPES.filter(
  (scope) => scope !== "mcp:agent",
);
export const PIPELINE_REST_SCOPES = PIPELINE_SCOPES.filter(
  (scope) => scope !== "mcp:pipeline",
);

export type ResourceKind =
  | "apiRest"
  | "agentRest"
  | "pipelineRest"
  | "agentMcp"
  | "pipelineMcp"
  | "appMcp"
  | "accountRest";

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
  /** One sign-in for Aomi's own CLI and SDK, accepted on the three REST APIs. */
  apiRest: string;
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
    apiRest: `${portalOrigin}/v1`,
  };
}

/**
 * The MCP DPoP rollout switch, one committed value for the portal and the edge.
 * Flip it here to require DPoP-bound access tokens on every MCP resource.
 */
export const MCP_DPOP_REQUIRED = false;

export function resourcePolicies(
  resources: Resources,
  dpopRequired: boolean,
): readonly ResourcePolicy[] {
  const base: Omit<ResourcePolicy, "grantableScopes">[] = [
    {
      // One sign-in for Aomi's own CLI and SDK: every REST scope, accepted
      // on /v1/agent, /v1/pipeline and /v1/account (never on an MCP server),
      // and narrowed to the route's own scopes before it reaches the API.
      kind: "apiRest",
      identifier: resources.apiRest,
      allowedScopes: [
        ...new Set([
          ...AGENT_REST_SCOPES,
          ...PIPELINE_REST_SCOPES,
          ...ACCOUNT_SCOPES,
        ]),
      ],
      guestScopes: [
        "agent:read",
        "agent:write",
        "agent:actions:resolve",
        "pipeline:catalog",
        "pipeline:execute",
        OFFLINE_ACCESS_SCOPE,
      ],
      dpopBoundAccessTokensRequired: false,
    },
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
      guestScopes: [
        "pipeline:catalog",
        "pipeline:execute",
        OFFLINE_ACCESS_SCOPE,
      ],
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
      guestScopes: [
        "mcp:agent",
        "agent:read",
        "agent:write",
        OFFLINE_ACCESS_SCOPE,
      ],
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

/** An app's name as it appears in its MCP path, `/v1/apps/<name>/mcp`. */
const APP_NAME = /^[a-z0-9][a-z0-9-_]{0,62}$/;

/** The MCP resource locked to one app: the agent MCP with that app forced. */
export function appMcpResource(
  resources: Pick<Resources, "portalOrigin">,
  name: string,
): string {
  return `${resources.portalOrigin}/v1/apps/${name}/mcp`;
}

/** The app an app-locked MCP resource names; undefined for any other resource. */
export function appMcpName(
  resources: Pick<Resources, "portalOrigin">,
  resource: string,
): string | undefined {
  const prefix = `${resources.portalOrigin}/v1/apps/`;
  if (!resource.startsWith(prefix) || !resource.endsWith("/mcp"))
    return undefined;
  const name = resource.slice(prefix.length, -"/mcp".length);
  return APP_NAME.test(name) ? name : undefined;
}

/**
 * The policy of one resource: a fixed one, or an app-locked MCP resource,
 * which carries the agent MCP's scopes. Null for anything else.
 */
export function resourcePolicy(
  resources: Resources,
  dpopRequired: boolean,
  resource: string,
): ResourcePolicy | null {
  const policies = resourcePolicies(resources, dpopRequired);
  const fixed = policies.find((policy) => policy.identifier === resource);
  if (fixed) return fixed;
  const agentMcp = policies.find((policy) => policy.kind === "agentMcp")!;
  return appMcpName(resources, resource)
    ? { ...agentMcp, kind: "appMcp", identifier: resource }
    : null;
}

/** Whether a `/v1` (CLI and SDK) token also opens this resource: the three REST APIs, never an MCP server. */
export function acceptsApiToken(policy: Pick<ResourcePolicy, "kind">): boolean {
  return (
    policy.kind === "agentRest" ||
    policy.kind === "pipelineRest" ||
    policy.kind === "accountRest"
  );
}

/** Reduce a guest grant to what the resource lets a guest carry. */
export function guestScopesFor(
  policy: ResourcePolicy,
  requested: readonly string[],
): string[] {
  const ceiling = new Set(policy.guestScopes);
  return requested.filter((scope) => ceiling.has(scope));
}

/** What a caller may do. Granted by the credential, never by the endpoint. */
export type Capability =
  | "chat" // threads, turns, catalogs, simulations
  | "actions" // resolve staged actions and commits
  | "account" // own profile, identities, wallets, provider links, deactivation
  | "portal_session" // signed-in portal cookie session only: agent-wallet writes, platform links, disconnects
  | "account_read" // credits and usage statement
  | "payments" // top-ups and payment signatures
  | "settings" // installed apps, app secrets, BYOK keys
  | "safety_policy" // account and thread transaction safety
  | "backend_bearer" // a raw 15-minute backend token
  | "mcp"; // MCP transport, OAuth grants only

const SIGNED_IN: readonly Capability[] = [
  "chat",
  "actions",
  "account",
  "account_read",
  "payments",
  "settings",
  "safety_policy",
  "backend_bearer",
];
const GUEST: readonly Capability[] = [
  "chat",
  "actions",
  "account",
  "backend_bearer",
];
// Any https site may embed the widget, so its sessions never get a raw backend
// token.

/** Session-shaped principals; OAuth grants are the token's own scopes. */
export type SessionKind = "cookie" | "session_bearer" | "widget";

const EMBEDDED: readonly Capability[] = ["backend_bearer"];

const GRANTS: Record<
  SessionKind,
  { user: readonly Capability[]; guest: readonly Capability[] }
> = {
  cookie: { user: [...SIGNED_IN, "portal_session"], guest: GUEST },
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

export function capabilitiesOf(
  kind: SessionKind,
  guest: boolean,
): readonly Capability[] {
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
export function scopesOn(
  principal: Exclude<PolicyPrincipal, { kind: "none" }>,
  policy: ResourcePolicy,
): readonly string[] {
  if (principal.kind === "oauth") return principal.scopes;
  const granted = capabilitiesOf(principal.kind, principal.guest);
  return policy.allowedScopes.filter((scope) => {
    const capability = capabilityOfScope(scope);
    return capability !== undefined && granted.includes(capability);
  });
}

/** What a route needs: a capability, or scopes on a protected resource. */
export type Need =
  | { capability: Capability; anonymous?: true }
  | { resource: string; scopes: readonly string[] };

export type Denial = {
  status: 401 | 403;
  code:
    | "unauthenticated"
    | "invalid_token"
    | "insufficient_scope"
    | "portal_session_required";
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
    if (principal.kind === "oauth")
      return { denied: { status: 401, code: "invalid_token" } };
    return capabilitiesOf(principal.kind, principal.guest).includes(
      need.capability,
    )
      ? { scopes: [] }
      : {
          denied: {
            status: 403,
            code:
              need.capability === "portal_session"
                ? "portal_session_required"
                : "insufficient_scope",
          },
        };
  }
  const held = scopesOn(principal, policyFor(need.resource));
  if (need.scopes.some((scope) => !held.includes(scope))) {
    return {
      denied: {
        status: 403,
        code: "insufficient_scope",
        requiredScopes: need.scopes,
      },
    };
  }
  return { scopes: [...new Set(need.scopes)] };
}

// ── The route table ──────────────────────────────────────────────────────

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** `appMcp`: the agent MCP locked to the app the path names (`/v1/apps/<app>/mcp`). */
export type ResourceKey =
  | "agentRest"
  | "pipelineRest"
  | "accountRest"
  | "agentMcp"
  | "pipelineMcp"
  | "appMcp";

/**
 * What a method needs: a scope on the row's resource, a capability (optionally
 * allowing anonymous callers), a signed-in portal session, or nothing. A
 * capability may name the scope OAuth callers need instead, on the same row's
 * resource.
 */
export type Requirement =
  | string
  | { capability: Capability; anonymous?: true; oauthScope?: string }
  | typeof PORTAL_SESSION
  | "public";

/**
 * Only a signed-in, non-guest portal cookie session: never a widget, a CLI
 * session or an OAuth client. Agent-wallet, lane and link writes; the backend
 * checks the same thing on the bearer's `auth_source`.
 */
export const PORTAL_SESSION = "portal_session";

export type Route = {
  path: RegExp;
  /** Names the route in logs; an account route's handler is found by it. */
  operation: string;
  /**
   * backend: the Rust /api with an account bearer (or none); agent / payment:
   * a bearer scoped to the resource and the receiving service; mcp: OAuth
   * grants only, carrying every scope of the grant; bearer: a raw backend
   * bearer for a browser that calls the Rust backend cross-origin itself;
   * account: served by the edge itself against the account database.
   */
  to: "backend" | "agent" | "payment" | "mcp" | "bearer" | "account";
  methods: Partial<Record<Method, Requirement>>;
  /** The OAuth resource scoped requirements are checked on; it also shapes auth failures. */
  on?: ResourceKey;
  /** A signed payment adds `payments:submit` to the scopes needed. */
  paid?: true;
  /** MCP: the scopes a refused client must re-authorize with. */
  challengeScopes?: readonly string[];
  /** Approving lets Aomi sign with an agent wallet: never a guest or an embedded widget. */
  approve?: true;
  /** backend: a /v1 name for a backend /api route, `[the /v1 prefix, the backend's]`. */
  rewrite?: readonly [string, string];
};

const chat = { capability: "chat", anonymous: true } as const;
const settings = { capability: "settings" } as const;
const commit = {
  on: "agentRest",
  to: "backend",
  operation: "proxy.request",
} as const;
const signedIn = { capability: "account" } as const;
/** Served by the edge itself: sign-in, the account graph, widget and device login. */
const own = (
  path: RegExp,
  operation: string,
  methods: Route["methods"],
): Route => ({ path, methods, to: "account", operation });
const backend = (path: RegExp, methods: Route["methods"]): Route => ({
  path,
  methods,
  to: "backend",
  operation: "proxy.request",
});
const account = (path: RegExp, methods: Route["methods"]): Route => ({
  path,
  methods,
  to: "agent",
  on: "accountRest",
  operation: "account.request",
});
const payment = (
  path: RegExp,
  methods: Route["methods"],
  paid?: true,
): Route => ({
  path,
  methods,
  to: "payment",
  on: "accountRest",
  operation: "account.payment",
  ...(paid ? { paid } : {}),
});

/** Served by the backend under its /api name, on the account resource. */
const renamed =
  (from: string, to: string) =>
  (path: RegExp, methods: Route["methods"]): Route => ({
    ...backend(path, methods),
    on: "accountRest",
    rewrite: [from, to],
  });
/** The secrets vault: BYOK provider keys and values tools use by handle. */
const keys = renamed("/v1/account/keys", "/api/secrets");
/** On-chain spending policies (Swig): prepare, sign and confirm a binding or its revoke. */
const policies = renamed(
  "/v1/account/policies",
  "/api/account/onchain-policies",
);

const ID = "[0-9a-f-]+";
const REF = "[A-Za-z0-9_-]+";
const AGENT = /^\/v1\/agent(?!\/mcp$)(\/.*)?$/;
const FUNDING = "\\/v1\\/account\\/credits\\/funding-events";
/**
 * The account's wallets, its agent wallets (create, rename, pause, archive,
 * withdraw), pause-all, each connection's label and agent wallets, and linking
 * a platform account with a one-time code. Served by the backend under /v1.
 * Reads take the scope api-server asks of OAuth clients; writes are for a
 * portal session only.
 */
const wallets = (
  path: RegExp,
  methods: Route["methods"],
  extra: Partial<Route> = {},
): Route => ({
  path,
  methods,
  to: "backend",
  on: "agentRest",
  operation: "account.wallets",
  ...extra,
});

export const ROUTES: readonly Route[] = [
  {
    path: /^\/v1\/agent\/mcp$/,
    operation: "agent.mcp",
    to: "mcp",
    on: "agentMcp",
    paid: true,
    methods: { POST: "mcp:agent" },
    challengeScopes: [
      "mcp:agent",
      "agent:read",
      "agent:write",
      "offline_access",
    ],
  },
  {
    path: /^\/v1\/pipeline\/mcp$/,
    operation: "pipeline.mcp",
    to: "mcp",
    on: "pipelineMcp",
    paid: true,
    methods: { POST: "mcp:pipeline" },
    // Every tool scope the MCP serves: a client signs in once for what its
    // tools/call needs (aomi_call_tool, aomi_run, aomi_wallets execute).
    challengeScopes: [
      "mcp:pipeline",
      "pipeline:catalog",
      "pipeline:execute",
      "offline_access",
    ],
  },
  {
    // The agent MCP locked to one app; the token must be for exactly this
    // path, and api-server resolves the app (404 app_not_found).
    path: /^\/v1\/apps\/[^/]+\/mcp$/,
    operation: "app.mcp",
    to: "mcp",
    on: "appMcp",
    paid: true,
    methods: { POST: "mcp:agent" },
    challengeScopes: [
      "mcp:agent",
      "agent:read",
      "agent:write",
      "offline_access",
    ],
  },
  {
    path: AGENT,
    operation: "agent.request",
    to: "agent",
    on: "agentRest",
    methods: { GET: "agent:read" },
  },
  {
    path: /^\/v1\/agent\/.*\/actions\/[^/]+\/result$/,
    operation: "agent.request",
    to: "agent",
    on: "agentRest",
    methods: {
      POST: "agent:actions:resolve",
      PATCH: "agent:actions:resolve",
      DELETE: "agent:actions:resolve",
    },
  },
  {
    path: AGENT,
    operation: "agent.request",
    to: "agent",
    on: "agentRest",
    paid: true,
    methods: {
      POST: "agent:write",
      PATCH: "agent:write",
      DELETE: "agent:write",
    },
  },
  {
    path: /^\/v1\/pipeline\/evm\/commits\/.*$/,
    operation: "pipeline.request",
    to: "agent",
    on: "pipelineRest",
    paid: true,
    methods: { GET: "pipeline:execute", POST: "pipeline:execute" },
  },
  {
    path: /^\/v1\/pipeline(?!\/mcp$)(\/.*)?$/,
    operation: "pipeline.request",
    to: "agent",
    on: "pipelineRest",
    paid: true,
    methods: { GET: "pipeline:catalog", POST: "pipeline:execute" },
  },
  payment(/^\/v1\/account\/credits(?:\/(?:methods|ledger))?$/, {
    GET: "account:credits:read",
  }),
  payment(new RegExp(`^${FUNDING}(?:\\/(?:current|[0-9a-f-]{36}))?$`), {
    GET: "account:credits:read",
  }),
  payment(
    new RegExp(`^${FUNDING}(?:\\/[0-9a-f-]{36}\\/cancel)?$`),
    { POST: "account:credits:fund" },
    true,
  ),
  payment(/^\/v1\/account\/statement$/, { GET: "account:usage:read" }),
  account(/^\/v1\/account\/apps$/, { GET: "account:apps:read" }),
  account(/^\/v1\/account\/apps\/[1-9]\d*$/, {
    POST: "account:apps:write",
    DELETE: "account:apps:write",
  }),
  account(/^\/v1\/account\/apps\/[1-9]\d*\/secrets$/, {
    GET: "account:credentials:read",
    POST: "account:credentials:write",
    DELETE: "account:credentials:write",
  }),
  account(/^\/v1\/account\/apps\/[1-9]\d*\/secrets\/[A-Za-z_]\w{0,127}$/, {
    DELETE: "account:credentials:write",
  }),
  account(/^\/v1\/account\/transaction-safety(?:\/threads\/[^/]+)?$/, {
    GET: "account:transaction-safety:read",
    PUT: "account:transaction-safety:write",
  }),
  keys(/^\/v1\/account\/keys$/, {
    GET: "account:credentials:read",
    POST: "account:credentials:write",
    DELETE: "account:credentials:write",
  }),
  keys(/^\/v1\/account\/keys\/[^/]+$/, { DELETE: "account:credentials:write" }),
  policies(/^\/v1\/account\/policies\/[a-z]+$/, {
    GET: "account:transaction-safety:read",
  }),
  policies(
    /^\/v1\/account\/policies\/[a-z]+\/(?:prepare|confirm|\d+\/revoke\/(?:prepare|confirm))$/,
    {
      POST: "account:transaction-safety:write",
    },
  ),
  {
    path: /^\/v1\/account\/bearer$/,
    operation: "account.bearer",
    to: "bearer",
    methods: { GET: { capability: "backend_bearer" } },
  },
  // Anything else under these account resources is a 404 in the resource's shape.
  account(/^\/v1\/account\/(apps|transaction-safety)(\/.*)?$/, {}),
  wallets(/^\/v1\/account\/wallets$/, { GET: "agent:read" }),
  wallets(/^\/v1\/account\/agent-wallets$/, {
    GET: "agent:read",
    POST: PORTAL_SESSION,
  }),
  wallets(/^\/v1\/account\/agent-wallets\/[^/]+$/, { PATCH: PORTAL_SESSION }),
  wallets(/^\/v1\/account\/agent-wallets\/[^/]+\/balances$/, {
    GET: "agent:read",
  }),
  wallets(/^\/v1\/account\/agent-wallets\/[^/]+\/withdraw$/, {
    POST: PORTAL_SESSION,
  }),
  wallets(/^\/v1\/account\/pause-all$/, { PUT: PORTAL_SESSION }),
  wallets(/^\/v1\/account\/connection-settings\/[^/]+$/, {
    PUT: PORTAL_SESSION,
  }),
  wallets(/^\/v1\/account\/connections\/[^/]+\/wallets$/, {
    PUT: PORTAL_SESSION,
  }),
  wallets(
    /^\/v1\/account\/link\/[a-z]+\/(?:preview|confirm|cancel)$/,
    { POST: PORTAL_SESSION },
    { operation: "account.link" },
  ),
  // Thread-less commits by ref: the same account authority and backend as
  // /api/commits, with the scopes api-server asks of OAuth clients.
  {
    ...commit,
    path: new RegExp(`^\\/v1\\/commits\\/${REF}$`),
    methods: { GET: "agent:read" },
  },
  {
    ...commit,
    path: new RegExp(
      `^\\/v1\\/commits\\/${REF}\\/(?:sign|broadcast|attempts|reject|attempts\\/${REF}\\/report)$`,
    ),
    methods: { POST: "agent:write" },
  },
  // An OAuth client (the CLI, an AI or SDK app) reaches the backend, which
  // lets it approve only where its lane on the wallet asks in that client.
  {
    ...commit,
    path: new RegExp(`^\\/v1\\/commits\\/${REF}\\/approve$`),
    methods: { POST: "agent:write" },
    approve: true,
  },
  {
    ...commit,
    path: /^\/api\/commits$/,
    methods: { POST: "agent:actions:resolve" },
  },
  {
    ...commit,
    path: new RegExp(`^\\/api\\/commits\\/${ID}$`, "i"),
    methods: { GET: "agent:read" },
  },
  {
    ...commit,
    path: new RegExp(
      `^\\/api\\/commits\\/${ID}\\/(manual|wallet-attempts|wallet-attempts\\/${ID}\\/report)$`,
      "i",
    ),
    methods: { POST: "agent:actions:resolve" },
  },
  // `aomi wallets use`: a CLI or OAuth login switches its own thread's
  // wallet; the backend checks the account owns both.
  {
    ...backend(/^\/api\/thread\/wallet$/, { PUT: "agent:write" }),
    on: "agentRest",
  },
  // The backend's account record and its routes; transaction safety and
  // on-chain policies moved to /v1/account.
  backend(
    /^\/api\/account(?:\/(?!(?:transaction-safety|onchain-policies)(?:\/|$)).*)?$/,
    {
      GET: settings,
      POST: settings,
      PATCH: settings,
      PUT: settings,
      DELETE: settings,
    },
  ),
  backend(/^\/api\/integrations\/github-app\/oauth\/start$/, { GET: chat }),
  backend(/^\/api\/thread\/apps$/, { GET: chat }),
  backend(/^\/api\/thread\/models$/, { GET: "public" }),
  {
    ...backend(/^\/api\/thread\/model$/, {
      POST: { ...chat, oauthScope: "agent:write" },
    }),
    on: "agentRest",
  },
  {
    ...backend(/^\/api\/thread\/sim\/world$/, {
      POST: { capability: "chat", oauthScope: "agent:write" },
    }),
    on: "agentRest",
  },
  backend(/^\/api\/exec\/simulate$/, { POST: chat }),
  own(/^\/v1\/account$/, "account", {
    GET: { ...signedIn, anonymous: true },
    PATCH: signedIn,
    DELETE: signedIn,
  }),
  own(/^\/v1\/account\/identities\/(?<id>[^/]+)$/, "account.identity", {
    PATCH: signedIn,
    DELETE: signedIn,
  }),
  own(/^\/v1\/account\/connections$/, "account.connections", { GET: signedIn }),
  own(
    /^\/v1\/account\/connections\/oauth\/(?<client_id>[^/]+)$/,
    "account.connection",
    { DELETE: PORTAL_SESSION },
  ),
  own(/^\/v1\/account\/connections\/telegram$/, "account.connection.telegram", {
    DELETE: PORTAL_SESSION,
  }),
  own(/^\/v1\/account\/wallets\/link$/, "wallet.link", {
    GET: signedIn,
    POST: signedIn,
  }),
  own(/^\/v1\/account\/wallets\/(?<id>[^/]+)$/, "account.wallet", {
    PATCH: signedIn,
    DELETE: signedIn,
  }),
  own(/^\/v1\/account\/merge$/, "account.merge", { POST: signedIn }),
  own(/^\/v1\/account\/merge\/switch$/, "account.merge_switch", {
    POST: signedIn,
  }),
  own(/^\/v1\/account\/provider\/exchange$/, "provider.link", {
    POST: signedIn,
  }),
  // One guest sign-in; the two older paths stay for published SDKs (client <= 0.11, widget <= 4).
  own(/^\/api\/auth\/(?:guest|widget\/guest|sign-in\/anonymous)$/, "guest", { POST: "public" }),
  own(/^\/api\/auth\/widget\/exchange$/, "widget.provider.exchange", {
    POST: "public",
  }),
  own(/^\/api\/auth\/widget\/siwe\/nonce$/, "widget.siwe.nonce", {
    POST: "public",
  }),
  own(/^\/api\/auth\/widget\/siwe\/verify$/, "widget.siwe.verify", {
    POST: "public",
  }),
  own(/^\/api\/auth\/widget\/siws\/nonce$/, "widget.siws.nonce", {
    POST: "public",
  }),
  own(/^\/api\/auth\/widget\/siws\/verify$/, "widget.siws.verify", {
    POST: "public",
  }),
  own(/^\/api\/auth\/widget\/session$/, "widget.session.revoke", {
    DELETE: "public",
  }),
  own(
    /^\/api\/auth\/widget\/oauth-bootstrap$/,
    "widget.oauth_bootstrap.issue",
    { POST: signedIn },
  ),
];
