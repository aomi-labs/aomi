/**
 * The portal surface at the edge. One table names every route the edge serves
 * on a portal host: what the caller needs per method and which upstream gets
 * the request. The edge identifies the caller, checks that need, mints the
 * bearer as `aomi-edge` and forwards under a header policy. Anything not in
 * the table passes through to the Vercel portal unchanged (sign-in, the
 * account graph, Better Auth, device auth).
 */
import {
  appMcpName,
  appMcpResource,
  authorize as decide,
  scopesOn as heldScopes,
  type Capability,
  type Need,
  type Resources,
} from "@aomi-labs/account/policy";

import { edgeService } from "../identity";
import { config } from "../kernel/config";
import { preflight, withCors, type CorsPolicy } from "../kernel/cors";
import { minted, unreachable } from "../kernel/errors";
import { apiOrigins } from "../kernel/manager";
import { rankedPool } from "../kernel/pool";
import { passThrough, proxy, target } from "../kernel/proxy";
import { isPublicCatalogKind, publicCatalog } from "./catalog";
import { policyFor, type PortalContext } from "./context";
import { portalError } from "./errors";
import { AGENT_API_HEADERS, BACKEND_API_HEADERS, PUBLIC_DISCOVERY_HEADERS } from "./headers";
import { isOAuthCredential, PrincipalError, resolvePrincipal, type Principal } from "./principal";

export const ACCOUNT_BEARER_TTL_SECONDS = 15 * 60;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** `appMcp`: the agent MCP locked to the app the path names (`/v1/apps/<app>/mcp`). */
type ResourceKey = "agentRest" | "pipelineRest" | "accountRest" | "agentMcp" | "pipelineMcp" | "appMcp";

/**
 * What a method needs: a scope on the row's resource, a capability (optionally
 * allowing anonymous callers), a signed-in portal session, or nothing. A
 * capability may name the scope OAuth callers need instead, on the same row's
 * resource.
 */
type Requirement =
  | string
  | { capability: Capability; anonymous?: true; oauthScope?: string }
  | typeof PORTAL_SESSION
  | "public";

/**
 * Only a signed-in, non-guest portal cookie session: never a widget, a CLI
 * session or an OAuth client. Agent-wallet, lane and link writes; the backend
 * checks the same thing on the bearer's `auth_source`.
 */
const PORTAL_SESSION = "portal_session";

type Row = {
  path: RegExp;
  operation: string;
  /**
   * backend: the Rust /api with an account bearer (or none); agent / payment:
   * a bearer scoped to the resource and the receiving service; mcp: OAuth
   * grants only, carrying every scope of the grant; bearer: a raw backend
   * bearer for a browser that calls the Rust backend cross-origin itself.
   */
  to: "backend" | "agent" | "payment" | "mcp" | "bearer";
  methods: Partial<Record<Method, Requirement>>;
  /** The OAuth resource scoped requirements are checked on; it also shapes auth failures. */
  on?: ResourceKey;
  /** A signed payment adds `payments:submit` to the scopes needed. */
  paid?: true;
  /** Where on the backend, when not the same path. */
  rewrite?: (pathname: string) => string;
  /** MCP: the scopes a refused client must re-authorize with. */
  challengeScopes?: readonly string[];
  /** Approving lets Aomi sign with an agent wallet: never a guest or an embedded widget. */
  approve?: true;
};

const chat = { capability: "chat", anonymous: true } as const;
const settings = { capability: "settings" } as const;
const commit = { on: "agentRest", to: "backend", operation: "proxy.request" } as const;
const backend = (path: RegExp, methods: Row["methods"]): Row => ({ path, methods, to: "backend", operation: "proxy.request" });
const account = (path: RegExp, methods: Row["methods"]): Row => ({
  path,
  methods,
  to: "agent",
  on: "accountRest",
  operation: "account.request",
});
const payment = (path: RegExp, methods: Row["methods"], paid?: true): Row => ({
  path,
  methods,
  to: "payment",
  on: "accountRest",
  operation: "account.payment",
  ...(paid ? { paid } : {}),
});

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
const wallets = (path: RegExp, methods: Row["methods"], extra: Partial<Row> = {}): Row => ({
  path,
  methods,
  to: "backend",
  on: "agentRest",
  operation: "account.wallets",
  ...extra,
});

export const ROUTES: readonly Row[] = [
  {
    path: /^\/v1\/agent\/mcp$/,
    operation: "agent.mcp",
    to: "mcp",
    on: "agentMcp",
    paid: true,
    methods: { POST: "mcp:agent" },
    challengeScopes: ["mcp:agent", "agent:read", "agent:write", "offline_access"],
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
    challengeScopes: ["mcp:pipeline", "pipeline:catalog", "pipeline:execute", "offline_access"],
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
    challengeScopes: ["mcp:agent", "agent:read", "agent:write", "offline_access"],
  },
  { path: AGENT, operation: "agent.request", to: "agent", on: "agentRest", methods: { GET: "agent:read" } },
  {
    path: /^\/v1\/agent\/.*\/actions\/[^/]+\/result$/,
    operation: "agent.request",
    to: "agent",
    on: "agentRest",
    methods: { POST: "agent:actions:resolve", PATCH: "agent:actions:resolve", DELETE: "agent:actions:resolve" },
  },
  {
    path: AGENT,
    operation: "agent.request",
    to: "agent",
    on: "agentRest",
    paid: true,
    methods: { POST: "agent:write", PATCH: "agent:write", DELETE: "agent:write" },
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
  payment(/^\/v1\/account\/credits(?:\/(?:methods|ledger))?$/, { GET: "account:credits:read" }),
  payment(new RegExp(`^${FUNDING}(?:\\/(?:current|[0-9a-f-]{36}))?$`), { GET: "account:credits:read" }),
  payment(new RegExp(`^${FUNDING}(?:\\/[0-9a-f-]{36}\\/cancel)?$`), { POST: "account:credits:fund" }, true),
  payment(/^\/v1\/account\/statement$/, { GET: "account:usage:read" }),
  account(/^\/v1\/account\/apps$/, { GET: "account:apps:read" }),
  account(/^\/v1\/account\/apps\/[1-9]\d*$/, { POST: "account:apps:write", DELETE: "account:apps:write" }),
  account(/^\/v1\/account\/apps\/[1-9]\d*\/secrets$/, {
    GET: "account:credentials:read",
    POST: "account:credentials:write",
    DELETE: "account:credentials:write",
  }),
  account(/^\/v1\/account\/apps\/[1-9]\d*\/secrets\/[A-Za-z_]\w{0,127}$/, { DELETE: "account:credentials:write" }),
  account(/^\/v1\/account\/transaction-safety(?:\/threads\/[^/]+)?$/, {
    GET: "account:transaction-safety:read",
    PUT: "account:transaction-safety:write",
  }),
  {
    path: /^\/v1\/account\/bearer$/,
    operation: "account.bearer",
    to: "bearer",
    methods: { GET: { capability: "backend_bearer" } },
  },
  // Anything else under these account resources is a 404 in the resource's shape.
  account(/^\/v1\/account\/(apps|transaction-safety)(\/.*)?$/, {}),
  wallets(/^\/v1\/account\/wallets$/, { GET: "agent:read" }),
  wallets(/^\/v1\/account\/agent-wallets$/, { GET: "agent:read", POST: PORTAL_SESSION }),
  wallets(/^\/v1\/account\/agent-wallets\/[^/]+$/, { PATCH: PORTAL_SESSION }),
  wallets(/^\/v1\/account\/agent-wallets\/[^/]+\/balances$/, { GET: "agent:read" }),
  wallets(/^\/v1\/account\/agent-wallets\/[^/]+\/withdraw$/, { POST: PORTAL_SESSION }),
  wallets(/^\/v1\/account\/pause-all$/, { PUT: PORTAL_SESSION }),
  wallets(/^\/v1\/account\/connection-settings\/[^/]+$/, { PUT: PORTAL_SESSION }),
  wallets(/^\/v1\/account\/connections\/[^/]+\/wallets$/, { PUT: PORTAL_SESSION }),
  wallets(/^\/v1\/account\/link\/[a-z]+\/(?:preview|confirm|cancel)$/, { POST: PORTAL_SESSION }, { operation: "account.link" }),
  // Thread-less commits by ref: the same account authority and backend as
  // /api/commits, with the scopes api-server asks of OAuth clients.
  { ...commit, path: new RegExp(`^\\/v1\\/commits\\/${REF}$`), methods: { GET: "agent:read" } },
  {
    ...commit,
    path: new RegExp(`^\\/v1\\/commits\\/${REF}\\/(?:sign|broadcast|attempts|reject|attempts\\/${REF}\\/report)$`),
    methods: { POST: "agent:write" },
  },
  // An OAuth client (the CLI, an AI or SDK app) reaches the backend, which
  // lets it approve only where its lane on the wallet asks in that client.
  { ...commit, path: new RegExp(`^\\/v1\\/commits\\/${REF}\\/approve$`), methods: { POST: "agent:write" }, approve: true },
  { ...commit, path: /^\/api\/commits$/, methods: { POST: "agent:actions:resolve" } },
  { ...commit, path: new RegExp(`^\\/api\\/commits\\/${ID}$`, "i"), methods: { GET: "agent:read" } },
  {
    ...commit,
    path: new RegExp(`^\\/api\\/commits\\/${ID}\\/(manual|wallet-attempts|wallet-attempts\\/${ID}\\/report)$`, "i"),
    methods: { POST: "agent:actions:resolve" },
  },
  backend(/^\/api\/thread\/transaction-safety$/, {
    GET: { capability: "safety_policy" },
    PUT: { capability: "safety_policy" },
  }),
  // `aomi wallets use`: a CLI or OAuth login switches its own thread's
  // wallet; the backend checks the account owns both.
  { ...backend(/^\/api\/thread\/wallet$/, { PUT: "agent:write" }), on: "agentRest" },
  backend(/^\/api\/account(\/.*)?$/, { GET: settings, POST: settings, PATCH: settings, PUT: settings, DELETE: settings }),
  backend(/^\/api\/secrets$/, { GET: settings, POST: settings, DELETE: settings }),
  backend(/^\/api\/secrets\/[^/]+$/, { DELETE: settings }),
  backend(/^\/api\/integrations\/github-app\/oauth\/start$/, { GET: chat }),
  backend(/^\/api\/thread\/apps$/, { GET: chat }),
  backend(/^\/api\/thread\/models$/, { GET: "public" }),
  backend(/^\/api\/resource\/skills(?:\/[^/]+)?$/, { GET: chat }),
  {
    ...backend(/^\/api\/thread\/model$/, { POST: { ...chat, oauthScope: "agent:write" } }),
    on: "agentRest",
  },
  {
    ...backend(/^\/api\/thread\/sim\/world$/, { POST: { capability: "chat", oauthScope: "agent:write" } }),
    on: "agentRest",
  },
  backend(/^\/api\/exec\/simulate$/, { POST: chat }),
];

/** The OAuth resource a row checks scopes on: fixed, or the app MCP its path names (null: no such app). */
function resourceOf(row: Row, request: Request, resources: Resources): string | null | undefined {
  if (row.on !== "appMcp") return row.on && resources[row.on];
  const resource = appMcpResource(resources, new URL(request.url).pathname.split("/")[3] ?? "");
  return appMcpName(resources, resource) ? resource : null;
}

/** The resolved need, or "public". */
function needOf(row: Row, requirement: Requirement, request: Request, resource: string | undefined): Need | "public" {
  if (requirement === "public") return "public";
  if (requirement === PORTAL_SESSION) return { capability: "portal_session" };
  if (typeof requirement !== "string") {
    // Fuzzer setup accepts Agent grants; browser and widget sessions retain
    // their existing capability policy, including each route's guest access.
    if (!requirement.oauthScope || !isOAuthCredential(request)) return requirement;
    requirement = requirement.oauthScope;
  }
  const scopes = [requirement];
  if (row.paid && request.headers.has("payment-signature")) scopes.push("payments:submit");
  return { resource: resource!, scopes };
}

/** The one permission check, from `@aomi-labs/account/policy`: the scopes to mint, or a PrincipalError. */
export function authorize(principal: Principal, need: Need, ctx: PortalContext): string[] {
  const result = decide(principal, need, (resource) => policyFor(resource, ctx));
  if ("scopes" in result) return result.scopes;
  const { status, code, requiredScopes } = result.denied;
  throw new PrincipalError(status, code, requiredScopes);
}

/** The scopes a principal holds on a protected resource. */
export function scopesOn(
  principal: Exclude<Principal, { kind: "none" }>,
  resource: string,
  ctx: PortalContext,
): readonly string[] {
  return heldScopes(principal, policyFor(resource, ctx));
}

/**
 * The open widget: any https site (or a local dev host) may embed it without
 * registering. Nothing allows credentials, so only an explicit widget session
 * or OAuth token can authorize a cross-origin call.
 */
const openWidget = (methods: readonly string[]): CorsPolicy => ({
  origin: "echo",
  methods,
  headers: [
    "Authorization", "Content-Type", "Aomi-App-Key", "Last-Event-ID", "DPoP", "Idempotency-Key",
    "Payment-Signature", "X-Aomi-Inference-Funding", "X-Aomi-Run-Budget-Microusd", "X-Aomi-CSRF",
    "X-Request-Id", "X-Session-Id", "X-Thread-Id",
  ],
  expose: [
    "DPoP-Nonce", "WWW-Authenticate", "Payment-Required", "Payment-Receipt", "Payment-Response",
    "X-Payment-Response", "Retry-After", "X-Request-Id",
  ],
  maxAge: 600,
});

/** Credential-free documents anyone may read (catalogs, discovery). */
const publicRead = (methods: readonly string[] = ["GET", "HEAD"]): CorsPolicy => ({ origin: "any", methods });

/** The backend's thread extractors read X-Thread-Id; widgets send X-Session-Id. */
function threadId(request: Request): Record<string, string> | undefined {
  const session = request.headers.get("x-session-id");
  return session && !request.headers.has("x-thread-id") ? { "x-thread-id": session } : undefined;
}

function serviceOrigin(ctx: PortalContext, service: "agent" | "payment"): string {
  const { apiServer, payment } = config(ctx.env);
  const origin = service === "payment" ? payment : apiServer;
  if (!origin) throw unreachable(new Error(`${service} origin is not configured`));
  return origin;
}

/** How the caller signed in, as the backend records it: thread origin, approval lane, portal-only writes. */
export function authSource(principal: Exclude<Principal, { kind: "none" }>): "session" | "cli_session" | "widget" | "oauth" {
  switch (principal.kind) {
    case "cookie":
      return "session";
    case "session_bearer":
      return "cli_session";
    case "widget":
      return "widget";
    case "oauth":
      return "oauth";
  }
}

/**
 * Who the caller is, for a first-party backend bearer: how it signed in, its
 * class and, for an OAuth client, which one. No `scope`: the backend reads a
 * scope-less `aomi-edge` user bearer with an `auth_source` as a first-party
 * session, and an OAuth caller by its client id (an approval lane is per client).
 */
export function callerClaims(principal: Exclude<Principal, { kind: "none" }>) {
  return {
    auth_source: authSource(principal),
    principal_class: principal.guest ? "guest" : "user",
    client_id: principal.kind === "oauth" ? principal.clientId : undefined,
  } as const;
}

/** Approving lets Aomi sign with an agent wallet: a first-party session or an OAuth client, never a guest or widget. */
function mayApprove(principal: Exclude<Principal, { kind: "none" }>): boolean {
  return principal.kind !== "widget" && !principal.guest;
}

function mintToken(ctx: PortalContext, request: Request, claims: Parameters<ReturnType<typeof edgeService>["mint"]>[0]) {
  return minted(() => edgeService(ctx.env, new URL(request.url).host).mint(claims));
}

function mint(ctx: PortalContext, request: Request, claims: Parameters<ReturnType<typeof edgeService>["mint"]>[0]) {
  return mintToken(ctx, request, claims).then((token) => token.accessToken);
}

/**
 * The backend's /api (or the manager, for its control-plane routes), with an
 * account bearer or anonymously.
 */
async function toBackend(row: Row, request: Request, principal: Principal, ctx: PortalContext): Promise<Response> {
  const { search } = new URL(request.url);
  const pathname = row.rewrite?.(new URL(request.url).pathname) ?? new URL(request.url).pathname;
  const bearer =
    "accountId" in principal
      ? await mint(ctx, request, {
          role: "user",
          subject: principal.accountId,
          audience: "aomi-backend",
          ttlSeconds: ACCOUNT_BEARER_TTL_SECONDS,
          delegated: callerClaims(principal),
        })
      : undefined;
  const targets = apiOrigins(request, ctx.env, pathname).map((origin) => {
    const url = target(origin, pathname, search);
    if (url.pathname === "/api/thread/apps" && !url.searchParams.has("platform"))
      for (const platform of config(ctx.env).portal.catalogPlatforms) url.searchParams.append("platform", platform);
    return url;
  });
  return proxy(request, targets, { fetchImpl: ctx.fetchImpl, headers: BACKEND_API_HEADERS, bearer, set: threadId(request) });
}

/** The agent API or payment service, with a bearer scoped to both the resource and the service. */
async function toScopedApi(
  request: Request,
  principal: Exclude<Principal, { kind: "none" }>,
  scopes: readonly string[],
  resource: string,
  service: "agent" | "payment",
  ctx: PortalContext,
): Promise<Response> {
  const { pathname, search } = new URL(request.url);
  const oauth = principal.kind === "oauth" ? principal : null;
  const bearer = await mint(ctx, request, {
    role: "user",
    subject: principal.accountId,
    audience: service === "payment" ? "aomi-payment" : "aomi-api-server",
    ttlSeconds: ACCOUNT_BEARER_TTL_SECONDS,
    delegated: {
      scope: scopes.join(" "),
      resource,
      ...callerClaims(principal),
      grant_id: oauth?.grantId,
      // A raw session token never enters an internal assertion; only the fact that one exists.
      sid: !oauth || oauth.sessionBound ? "session-bound" : undefined,
    },
  });
  return proxy(request, target(serviceOrigin(ctx, service), pathname, search), {
    fetchImpl: ctx.fetchImpl,
    headers: AGENT_API_HEADERS,
    bearer,
    set: threadId(request),
  });
}

async function serve(
  row: Row,
  need: Need | "public",
  resource: string | undefined,
  request: Request,
  ctx: PortalContext,
): Promise<Response> {
  if (need === "public") return toBackend(row, request, { kind: "none" }, ctx);
  const started = Date.now();
  const principal = await resolvePrincipal(request, need, ctx);
  if (row.to === "mcp" && principal.kind !== "oauth") throw new PrincipalError(401, "invalid_token");
  const scopes = authorize(principal, need, ctx);
  if (row.approve && principal.kind !== "none" && !mayApprove(principal))
    return Response.json({ code: "commit_approval_forbidden", status: 403 }, { status: 403 });
  const authMs = Date.now() - started;
  let response: Response;
  if (row.to === "backend") {
    response = await toBackend(row, request, principal, ctx);
  } else if (principal.kind === "none" || (row.to === "bearer" && principal.kind === "oauth")) {
    throw new PrincipalError(401, "unauthenticated");
  } else if (row.to === "bearer") {
    // Hosted backends trust `aomi-edge` only, so the former Vercel `aomi-bff` mint moved here.
    const { accessToken, expiresAt } = await mintToken(ctx, request, {
      role: "user",
      subject: principal.accountId,
      audience: "aomi-backend",
      ttlSeconds: ACCOUNT_BEARER_TTL_SECONDS,
    });
    response = Response.json({ bearer: accessToken, expires_at: expiresAt }, { headers: { "cache-control": "no-store" } });
  } else {
    // MCP: Rust maps each tools/call to its business scope, so the bearer
    // carries every scope of the grant; the edge never reads the body.
    const minted = row.to === "mcp" ? scopesOn(principal, resource!, ctx) : scopes;
    response = await toScopedApi(request, principal, minted, resource!, row.to === "payment" ? "payment" : "agent", ctx);
  }
  response = new Response(response.body, response);
  response.headers.append("server-timing", `edge_auth;dur=${authMs.toFixed(1)}`);
  return response;
}

/** Serve the request with the rows its path matches. */
async function served(rows: readonly Row[], request: Request, ctx: PortalContext): Promise<Response> {
  const methods = [...new Set(rows.flatMap((row) => Object.keys(row.methods)))];
  const cfg = config(ctx.env);
  const cors = openWidget(methods);
  if (request.method === "OPTIONS") return preflight(cors, request, cfg);
  const row = rows.find((candidate) => request.method in candidate.methods) ?? rows[0];
  const requirement = row.methods[request.method as Method];
  const resource = resourceOf(row, request, ctx.resources);
  let response: Response;
  if (requirement === undefined)
    // A protected resource answers in its own error shape; the backend allowlist in the plain one.
    response =
      row.on && row.to !== "backend"
        ? Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 })
        : Response.json({ error: "not_found" }, { status: 404 });
  else if (resource === null) response = Response.json({ error: "app_not_found" }, { status: 404 });
  else
    try {
      response = await serve(row, needOf(row, requirement, request, resource), resource, request, ctx);
    } catch (error) {
      // A portal-only refusal is not an OAuth challenge.
      const plain = error instanceof PrincipalError && error.code === "portal_session_required";
      const shape = !plain && resource && { resource, challengeScopes: row.challengeScopes, jsonRpc: row.to === "mcp" };
      response = portalError(error, request, row.operation, shape || undefined, row.to === "mcp" ? "mcp_failed" : undefined);
    }
  return withCors(cors, request, response, cfg);
}

/** Public, credential-free discovery documents the agent API publishes. */
async function discovery(request: Request, ctx: PortalContext): Promise<Response> {
  const { pathname, search } = new URL(request.url);
  const cors = publicRead();
  const cfg = config(ctx.env);
  if (request.method === "OPTIONS") return preflight(cors, request, cfg);
  let response: Response;
  if (request.method !== "GET" && request.method !== "HEAD")
    response = new Response(null, { status: 405, headers: { allow: "GET, HEAD, OPTIONS" } });
  else
    try {
      response = await proxy(request, target(serviceOrigin(ctx, "agent"), pathname, search), {
        fetchImpl: ctx.fetchImpl,
        headers: PUBLIC_DISCOVERY_HEADERS,
      });
    } catch (error) {
      response = portalError(error, request, "discovery");
    }
  return withCors(cors, request, response, cfg);
}

async function catalog(request: Request, kind: string, ctx: PortalContext): Promise<Response> {
  const cors = publicRead(["GET"]);
  const cfg = config(ctx.env);
  if (request.method === "OPTIONS") return preflight(cors, request, cfg);
  const [origin] = rankedPool(request, ctx.env);
  const response =
    !isPublicCatalogKind(kind) || (request.method !== "GET" && request.method !== "HEAD")
      ? Response.json({ error: "not_found" }, { status: 404 })
      : origin
        ? await publicCatalog(request, kind, origin, ctx.fetchImpl)
        : Response.json({ error: "catalog_unavailable" }, { status: 502 });
  return withCors(cors, request, response, cfg);
}

/** Serve one request on the portal surface. */
export async function handlePortalRequest(request: Request, ctx: PortalContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/.well-known/api-catalog") return discovery(request, ctx);
  const catalogKind = /^\/api\/public\/catalog\/([^/]+)$/.exec(pathname)?.[1];
  if (catalogKind) return catalog(request, catalogKind, ctx);
  const rows = ROUTES.filter((row) => row.path.test(pathname));
  if (rows.length) return served(rows, request, ctx);
  return passThrough(request, ctx.upstreamOrigin, ctx.fetchImpl, "portal");
}
