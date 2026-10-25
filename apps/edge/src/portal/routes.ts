/**
 * The portal surface at the edge: every portal BFF route family marked "moves"
 * in the design. The edge identifies the caller, checks the capability or
 * scopes the route needs, mints the bearer as `aomi-edge` and forwards with a
 * header policy. Anything not listed here passes through to the Vercel portal
 * unchanged (sign-in, the account graph, Better Auth, device auth).
 */
import { edgeService } from "../identity";
import { isManagerPath } from "../api/routes";
import { config } from "../kernel/config";
import { preflight, withCors, type CorsPolicy } from "../kernel/cors";
import { minted, unreachable } from "../kernel/errors";
import { rankedPool } from "../kernel/pool";
import { passThrough as passThroughTo, proxy, target } from "../kernel/proxy";
import { isPublicCatalogKind, publicCatalog } from "./catalog";
import type { PortalContext } from "./context";
import { portalError } from "./errors";
import { AGENT_API_HEADERS, BACKEND_API_HEADERS, PUBLIC_DISCOVERY_HEADERS } from "./headers";
import {
  capabilitiesOf,
  DELEGATING_SCOPES,
  policyFor,
  sessionScopesOn,
  type Need,
} from "./policy";
import { PrincipalError, resolvePrincipal, type Principal } from "./principal";

export const ACCOUNT_BEARER_TTL_SECONDS = 15 * 60;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const ALL_METHODS: readonly Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

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

/** What a route handler receives once the caller is identified and authorized. */
export type Call = {
  request: Request;
  principal: Principal;
  /** Scopes to mint for a protected resource; empty for capability routes. */
  scopes: string[];
  ctx: PortalContext;
};

type Handle = (call: Call) => Promise<Response>;

type Family = {
  operation: string;
  methods: readonly Method[];
  /**
   * What the caller needs. "public" skips identification; null means there is
   * no such route here (404 in the resource's shape).
   */
  need: (request: Request) => Need | "public" | null;
  handle: Handle;
  /** An OAuth protected resource answers auth failures and 404s in its own shape. */
  resource?: (ctx: PortalContext) => string;
  cors?: "open_widget" | "none";
  fallback?: string;
  /** MCP: the scopes a client must re-authorize with when its token is refused. */
  challengeScopes?: readonly string[];
  /** MCP answers in JSON-RPC error shape. */
  jsonRpc?: boolean;
  /** MCP transports take OAuth grants only; a session credential is an invalid token. */
  oauthOnly?: boolean;
};

/** The one permission check: the scopes to mint, or a PrincipalError. */
export function authorize(principal: Principal, need: Need, ctx: PortalContext): string[] {
  if (principal.kind === "none") {
    if ("capability" in need && need.anonymous) return [];
    throw new PrincipalError(401, "unauthenticated");
  }
  if ("capability" in need) {
    if (principal.kind === "oauth") throw new PrincipalError(401, "invalid_token");
    if (!capabilitiesOf(principal.kind, principal.guest).includes(need.capability))
      throw new PrincipalError(403, "insufficient_scope");
    return [];
  }
  const held = scopesOn(principal, need.resource, ctx);
  if (need.scopes.some((scope) => !held.includes(scope)))
    throw new PrincipalError(403, "insufficient_scope", need.scopes);
  const minted = [...new Set(need.scopes)];
  if (need.scopes.some((scope) => DELEGATING_SCOPES.includes(scope)) && held.includes("custody:delegate"))
    minted.push("custody:delegate");
  return minted;
}

/** The scopes a principal holds on a protected resource. */
export function scopesOn(
  principal: Exclude<Principal, { kind: "none" }>,
  resource: string,
  ctx: PortalContext,
): readonly string[] {
  if (principal.kind === "oauth") return principal.scopes;
  return sessionScopesOn(principal.kind, principal.guest, policyFor(resource, ctx.resources, ctx.dpopRequired));
}

function notFound(resource: string | undefined): Response {
  return resource
    ? Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 })
    : Response.json({ error: "not_found" }, { status: 404 });
}

async function runFamily(family: Family, request: Request, ctx: PortalContext): Promise<Response> {
  const methods = family.methods;
  const cfg = config(ctx.env);
  const cors = openWidget(methods);
  if (request.method === "OPTIONS")
    return family.cors === "none" ? new Response(null, { status: 204 }) : preflight(cors, request, cfg);
  const need = family.need(request);
  const resource =
    family.resource?.(ctx) ??
    (need && need !== "public" && "resource" in need ? need.resource : undefined);
  let response: Response;
  try {
    if (!methods.includes(request.method as Method) || need === null) {
      response = notFound(resource);
    } else if (need === "public") {
      response = await family.handle({ request, principal: { kind: "none" }, scopes: [], ctx });
    } else {
      const started = Date.now();
      const principal = await resolvePrincipal(request, need, ctx);
      if (family.oauthOnly && principal.kind !== "oauth")
        throw new PrincipalError(401, "invalid_token");
      const scopes = authorize(principal, need, ctx);
      const authMs = Date.now() - started;
      response = await family.handle({ request, principal, scopes, ctx });
      response = new Response(response.body, response);
      response.headers.append("server-timing", `edge_auth;dur=${authMs.toFixed(1)}`);
    }
  } catch (error) {
    const shape = resource
      ? { resource, challengeScopes: family.challengeScopes, jsonRpc: family.jsonRpc }
      : undefined;
    response = portalError(error, request, family.operation, shape, family.fallback);
  }
  return family.cors === "none" ? response : withCors(cors, request, response, cfg);
}

function hostOf(request: Request): string {
  return new URL(request.url).host;
}

/** Forward to the Rust backend's /api with an account bearer, or anonymously. */
async function toBackend(call: Call, path: string): Promise<Response> {
  const { ctx, request } = call;
  const incoming = new URL(request.url);
  const accountId = "accountId" in call.principal ? call.principal.accountId : null;
  const bearer = accountId
    ? (
        await minted(() =>
          edgeService(ctx.env, hostOf(request)).mint({
            role: "user",
            subject: accountId,
            audience: "aomi-backend",
            ttlSeconds: ACCOUNT_BEARER_TTL_SECONDS,
          }),
        )
      ).accessToken
    : undefined;
  // The deploy control plane moves to the manager with the same MANAGER_ORIGIN
  // switch the api surface uses; everything else is ranked over the backend pool.
  const { manager } = config(ctx.env);
  const origins =
    manager && isManagerPath(new URL(path, incoming).pathname) ? [manager] : rankedPool(request, ctx.env);
  const targets = origins.map((origin) => {
    const url = target(origin, path, incoming.search);
    if (url.pathname === "/api/thread/apps" && !url.searchParams.has("platform"))
      for (const platform of config(ctx.env).portal.catalogPlatforms) url.searchParams.append("platform", platform);
    return url;
  });
  return proxy(request, targets, { fetchImpl: ctx.fetchImpl, headers: BACKEND_API_HEADERS, bearer, set: threadId(request) });
}

/**
 * A raw backend bearer for a browser that calls the Rust backend cross-origin
 * itself (NEXT_PUBLIC_BACKEND_URL set to another origin). The former Vercel
 * route minted this as `aomi-bff`; hosted backends now trust `aomi-edge` only.
 */
async function accountBearer(call: Call): Promise<Response> {
  const { principal, ctx, request } = call;
  if (principal.kind === "none" || principal.kind === "oauth")
    throw new PrincipalError(401, "unauthenticated");
  const { accessToken, expiresAt } = await minted(() =>
    edgeService(ctx.env, hostOf(request)).mint({
      role: "user",
      subject: principal.accountId,
      audience: "aomi-backend",
      ttlSeconds: ACCOUNT_BEARER_TTL_SECONDS,
    }),
  );
  return Response.json(
    { bearer: accessToken, expires_at: expiresAt },
    { headers: { "cache-control": "no-store" } },
  );
}

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

/** Forward with a bearer scoped to both the resource and the receiving service. */
async function toScopedApi(call: Call, resource: string, service: "agent" | "payment"): Promise<Response> {
  const { principal, ctx, request } = call;
  if (principal.kind === "none") throw new Error("scoped API call without a principal");
  const incoming = new URL(request.url);
  const { accessToken } = await minted(() =>
    edgeService(ctx.env, hostOf(request)).mint({
      role: "user",
      subject: principal.accountId,
      audience: service === "payment" ? "aomi-payment" : "aomi-api-server",
      ttlSeconds: ACCOUNT_BEARER_TTL_SECONDS,
      delegated: {
        scope: call.scopes.join(" "),
        resource,
        client_id: principal.kind === "oauth" ? principal.clientId : undefined,
        auth_source: principal.kind === "oauth" ? "oauth" : "session",
        principal_class: principal.guest ? "guest" : "user",
        grant_id: principal.kind === "oauth" ? principal.grantId : undefined,
        // A raw session token never enters an internal assertion; only the
        // fact that one exists does.
        sid: principal.kind !== "oauth" || principal.sessionBound ? "session-bound" : undefined,
      },
    }),
  );
  return proxy(request, target(serviceOrigin(ctx, service), incoming.pathname, incoming.search), {
    fetchImpl: ctx.fetchImpl,
    headers: AGENT_API_HEADERS,
    bearer: accessToken,
    set: threadId(request),
  });
}

function withPayment(request: Request, scopes: string[]): string[] {
  return request.headers.has("payment-signature") ? [...scopes, "payments:submit"] : scopes;
}

function scopedApi(
  operation: string,
  methods: readonly Method[],
  resource: (ctx: PortalContext) => string,
  scopes: (request: Request) => string[] | null,
  service: "agent" | "payment" = "agent",
): (ctx: PortalContext) => Family {
  return (ctx) => ({
    operation,
    methods,
    resource,
    need: (request) => {
      const required = scopes(request);
      return required && { resource: resource(ctx), scopes: required };
    },
    handle: (call) => toScopedApi(call, resource(ctx), service),
  });
}

/**
 * MCP: the transport scope is checked with the token (the challenge names the
 * scopes a client must re-authorize with), then the bearer carries every scope
 * of the grant; Rust maps each tools/call to its business scope.
 */
function mcp(
  operation: string,
  resource: (ctx: PortalContext) => string,
  transport: "mcp:agent" | "mcp:pipeline",
  challengeScopes: readonly string[],
): (ctx: PortalContext) => Family {
  return (ctx) => ({
    operation,
    methods: ["POST"],
    resource,
    cors: "open_widget",
    need: (request) => ({ resource: resource(ctx), scopes: withPayment(request, [transport]) }),
    handle: async (call) => {
      if (call.principal.kind !== "oauth") throw new PrincipalError(401, "invalid_token");
      // Rust maps each tools/call to its business scope, so the bearer
      // carries every scope of the grant; the edge never reads the body.
      return toScopedApi(
        { ...call, scopes: [...scopesOn(call.principal, resource(ctx), ctx)] },
        resource(ctx),
        "agent",
      );
    },
    fallback: "mcp_failed",
    challengeScopes,
    jsonRpc: true,
    oauthOnly: true,
  });
}

/** Account control-plane paths and the scope each method needs. */
const ACCOUNT_CONTROL: readonly { path: RegExp; scopes: Record<string, string> }[] = [
  { path: /^\/v1\/account\/apps$/, scopes: { GET: "account:apps:read" } },
  {
    path: /^\/v1\/account\/apps\/[1-9]\d*$/,
    scopes: { POST: "account:apps:write", DELETE: "account:apps:write" },
  },
  {
    path: /^\/v1\/account\/apps\/[1-9]\d*\/secrets$/,
    scopes: {
      GET: "account:credentials:read",
      POST: "account:credentials:write",
      DELETE: "account:credentials:write",
    },
  },
  {
    path: /^\/v1\/account\/apps\/[1-9]\d*\/secrets\/[A-Za-z_]\w{0,127}$/,
    scopes: { DELETE: "account:credentials:write" },
  },
  {
    path: /^\/v1\/account\/transaction-safety(?:\/threads\/[^/]+)?$/,
    scopes: { GET: "account:transaction-safety:read", PUT: "account:transaction-safety:write" },
  },
];

function accountScope(request: Request): string[] | null {
  const { pathname } = new URL(request.url);
  const scope = ACCOUNT_CONTROL.find(({ path }) => path.test(pathname))?.scopes[request.method];
  return scope ? [scope] : null;
}

type BackendRoute = {
  path: RegExp;
  methods: readonly string[];
  need: Need | "public" | ((request: Request, ctx: PortalContext) => Need);
};

const commit = (request: Request, ctx: PortalContext): Need => ({
  resource: ctx.resources.agentRest,
  scopes: [request.method === "GET" ? "agent:read" : "agent:actions:resolve"],
});
const chat: Need = { capability: "chat", anonymous: true };

/** The Rust /api routes the portal forwards. Anything else is a 404. */
export const BACKEND_ROUTES: readonly BackendRoute[] = [
  { path: /^\/api\/commits$/, methods: ["POST"], need: commit },
  { path: /^\/api\/commits\/[0-9a-f-]+$/i, methods: ["GET"], need: commit },
  { path: /^\/api\/commits\/[0-9a-f-]+\/manual$/i, methods: ["POST"], need: commit },
  { path: /^\/api\/commits\/[0-9a-f-]+\/wallet-attempts$/i, methods: ["POST"], need: commit },
  {
    path: /^\/api\/commits\/[0-9a-f-]+\/wallet-attempts\/[0-9a-f-]+\/report$/i,
    methods: ["POST"],
    need: commit,
  },
  {
    path: /^\/api\/thread\/transaction-safety$/,
    methods: ["GET", "PUT"],
    need: { capability: "safety_policy" },
  },
  {
    path: /^\/api\/account(\/.*)?$/,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    need: { capability: "settings" },
  },
  { path: /^\/api\/secrets$/, methods: ["GET", "POST", "DELETE"], need: { capability: "settings" } },
  { path: /^\/api\/secrets\/[^/]+$/, methods: ["DELETE"], need: { capability: "settings" } },
  { path: /^\/api\/integrations\/github-app\/oauth\/start$/, methods: ["GET"], need: chat },
  { path: /^\/api\/thread\/apps$/, methods: ["GET"], need: chat },
  { path: /^\/api\/thread\/models$/, methods: ["GET"], need: "public" },
  { path: /^\/api\/resource\/skills(?:\/[^/]+)?$/, methods: ["GET"], need: chat },
  { path: /^\/api\/thread\/model$/, methods: ["POST"], need: chat },
  { path: /^\/api\/thread\/sim\/world$/, methods: ["POST"], need: { capability: "chat" } },
  { path: /^\/api\/exec\/simulate$/, methods: ["POST"], need: chat },
  {
    path: /^\/api\/widget\/v1\/execution-profile$/,
    methods: ["GET"],
    need: { capability: "managed_signing" },
  },
  {
    path: /^\/api\/widget\/v1\/aa-accounts\/[^/]+$/,
    methods: ["PUT"],
    need: { capability: "managed_signing" },
  },
  {
    path: /^\/api\/widget\/v1\/signing-requests\/sign%3A[^/]+$/i,
    methods: ["POST"],
    need: { capability: "managed_signing" },
  },
];

export function backendRoute(request: Request): BackendRoute | undefined {
  const { pathname } = new URL(request.url);
  return BACKEND_ROUTES.find(
    (route) => route.path.test(pathname) && route.methods.includes(request.method),
  );
}

/** Whether a portal /api path is one the edge forwards to Rust (any method). */
export function isBackendApiPath(pathname: string): boolean {
  return BACKEND_ROUTES.some((route) => route.path.test(pathname));
}

const FAMILIES = {
  backend: (ctx: PortalContext): Family => ({
    operation: "proxy.request",
    methods: ALL_METHODS,
    need: (request) => {
      const route = backendRoute(request);
      if (!route) return null;
      return typeof route.need === "function" ? route.need(request, ctx) : route.need;
    },
    handle: (call) => toBackend(call, new URL(call.request.url).pathname),
  }),
  agent: scopedApi(
    "agent.request",
    ["GET", "POST", "PATCH", "DELETE"],
    (ctx) => ctx.resources.agentRest,
    (request) => {
      if (request.method === "GET") return ["agent:read"];
      if (/\/actions\/[^/]+\/result$/.test(new URL(request.url).pathname))
        return ["agent:actions:resolve"];
      return withPayment(request, ["agent:write"]);
    },
  ),
  pipeline: scopedApi(
    "pipeline.request",
    ["GET", "POST"],
    (ctx) => ctx.resources.pipelineRest,
    (request) =>
      withPayment(request, [
        request.method === "GET" &&
        !new URL(request.url).pathname.startsWith("/v1/pipeline/evm/commits/")
          ? "pipeline:catalog"
          : "pipeline:execute",
      ]),
  ),
  credits: scopedApi(
    "account.credits",
    ["GET"],
    (ctx) => ctx.resources.accountRest,
    () => ["account:credits:read"],
    "payment",
  ),
  fundingEvents: scopedApi(
    "account.funding_events",
    ["GET", "POST"],
    (ctx) => ctx.resources.accountRest,
    (request) =>
      request.method === "GET"
        ? ["account:credits:read"]
        : withPayment(request, ["account:credits:fund"]),
    "payment",
  ),
  statement: scopedApi(
    "account.statement",
    ["GET"],
    (ctx) => ctx.resources.accountRest,
    () => ["account:usage:read"],
    "payment",
  ),
  accountApps: scopedApi(
    "account.apps",
    ["GET", "POST", "DELETE"],
    (ctx) => ctx.resources.accountRest,
    accountScope,
  ),
  transactionSafety: scopedApi(
    "account.transaction_safety",
    ["GET", "PUT"],
    (ctx) => ctx.resources.accountRest,
    accountScope,
  ),
  agentMcp: mcp("agent.mcp", (ctx) => ctx.resources.agentMcp, "mcp:agent", [
    "mcp:agent",
    "agent:read",
    "agent:write",
    "offline_access",
  ]),
  pipelineMcp: mcp("pipeline.mcp", (ctx) => ctx.resources.pipelineMcp, "mcp:pipeline", [
    "mcp:pipeline",
    "pipeline:catalog",
    "offline_access",
  ]),
  bearer: (): Family => ({
    operation: "account.bearer",
    methods: ["GET"],
    need: () => ({ capability: "backend_bearer" }),
    handle: accountBearer,
  }),
  delegationBegin: (provider: "privy" | "para") => (): Family => ({
    operation: `delegation.${provider}.begin`,
    methods: ["POST"],
    need: () => ({ capability: "account" }),
    handle: (call) => toBackend(call, `/api/auth/${provider}/begin`),
  }),
};

const FUNDING_EVENT_PATH =
  /^\/v1\/account\/credits\/funding-events(?:\/(?:current|[0-9a-f-]{36})(?:\/cancel)?)?$/;

/** Which moved family serves this portal path, if any. */
export function matchFamily(url: URL): ((ctx: PortalContext) => Family) | null {
  const { pathname } = url;
  if (pathname === "/v1/agent/mcp") return FAMILIES.agentMcp;
  if (pathname === "/v1/pipeline/mcp") return FAMILIES.pipelineMcp;
  if (pathname === "/v1/agent" || pathname.startsWith("/v1/agent/")) return FAMILIES.agent;
  if (pathname === "/v1/pipeline" || pathname.startsWith("/v1/pipeline/")) return FAMILIES.pipeline;
  if (/^\/v1\/account\/credits(?:\/(?:methods|ledger))?$/.test(pathname)) return FAMILIES.credits;
  if (FUNDING_EVENT_PATH.test(pathname)) return FAMILIES.fundingEvents;
  if (pathname === "/v1/account/statement") return FAMILIES.statement;
  if (pathname === "/v1/account/bearer") return FAMILIES.bearer;
  if (pathname === "/v1/account/apps" || pathname.startsWith("/v1/account/apps/"))
    return FAMILIES.accountApps;
  if (
    pathname === "/v1/account/transaction-safety" ||
    pathname.startsWith("/v1/account/transaction-safety/")
  )
    return FAMILIES.transactionSafety;
  const delegation = /^\/api\/delegation\/(privy|para)\/begin$/.exec(pathname);
  if (delegation) return FAMILIES.delegationBegin(delegation[1] as "privy" | "para");
  if (pathname.startsWith("/api/") && isBackendApiPath(pathname)) return FAMILIES.backend;
  return null;
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

/** Everything else: the Vercel portal serves it, cookies and all. */
export function passThrough(request: Request, ctx: PortalContext): Promise<Response> {
  return passThroughTo(request, ctx.upstreamOrigin, ctx.fetchImpl, "portal");
}

/** Serve one request on the portal surface. */
export async function handlePortalRequest(request: Request, ctx: PortalContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/.well-known/api-catalog") return discovery(request, ctx);
  const catalogMatch = /^\/api\/public\/catalog\/([^/]+)$/.exec(url.pathname);
  if (catalogMatch) return catalog(request, catalogMatch[1], ctx);
  const family = matchFamily(url);
  if (family) return runFamily(family(ctx), request, ctx);
  return passThrough(request, ctx);
}
