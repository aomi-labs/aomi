/**
 * The portal surface at the edge. One table names every route the edge serves
 * on a portal host: what the caller needs per method and which upstream gets
 * the request. The edge identifies the caller, checks that need, mints the
 * bearer as `aomi-edge` and forwards under a header policy. Anything not in
 * the table passes through to the Vercel portal unchanged (sign-in, the
 * account graph, Better Auth, device auth).
 */
import { edgeService } from "../identity";
import { isManagerPath } from "../api/routes";
import { config } from "../kernel/config";
import { preflight, withCors, type CorsPolicy } from "../kernel/cors";
import { minted, unreachable } from "../kernel/errors";
import { rankedPool } from "../kernel/pool";
import { passThrough, proxy, target } from "../kernel/proxy";
import { isPublicCatalogKind, publicCatalog } from "./catalog";
import type { PortalContext } from "./context";
import { portalError } from "./errors";
import { AGENT_API_HEADERS, BACKEND_API_HEADERS, PUBLIC_DISCOVERY_HEADERS } from "./headers";
import {
  capabilitiesOf,
  DELEGATING_SCOPES,
  policyFor,
  sessionScopesOn,
  type Capability,
  type Need,
  type Resources,
} from "./policy";
import { PrincipalError, resolvePrincipal, type Principal } from "./principal";

export const ACCOUNT_BEARER_TTL_SECONDS = 15 * 60;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ResourceKey = "agentRest" | "pipelineRest" | "accountRest" | "agentMcp" | "pipelineMcp";

/**
 * What a method needs: a scope on the row's resource, a capability (`?` lets
 * guests without a session in), or nothing at all.
 */
type Requirement = string | { capability: Capability; anonymous?: true } | "public";

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
};

const chat = { capability: "chat", anonymous: true } as const;
const settings = { capability: "settings" } as const;
const signing = { capability: "managed_signing" } as const;
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
const AGENT = /^\/v1\/agent(?!\/mcp$)(\/.*)?$/;
const FUNDING = "\\/v1\\/account\\/credits\\/funding-events";

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
    challengeScopes: ["mcp:pipeline", "pipeline:catalog", "offline_access"],
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
  {
    path: /^\/api\/delegation\/(privy|para)\/begin$/,
    operation: "delegation.begin",
    to: "backend",
    methods: { POST: { capability: "account" } },
    rewrite: (pathname) => pathname.replace(/^\/api\/delegation\/(privy|para)\/begin$/, "/api/auth/$1/begin"),
  },
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
  backend(/^\/api\/account(\/.*)?$/, { GET: settings, POST: settings, PATCH: settings, PUT: settings, DELETE: settings }),
  backend(/^\/api\/secrets$/, { GET: settings, POST: settings, DELETE: settings }),
  backend(/^\/api\/secrets\/[^/]+$/, { DELETE: settings }),
  backend(/^\/api\/integrations\/github-app\/oauth\/start$/, { GET: chat }),
  backend(/^\/api\/thread\/apps$/, { GET: chat }),
  backend(/^\/api\/thread\/models$/, { GET: "public" }),
  backend(/^\/api\/resource\/skills(?:\/[^/]+)?$/, { GET: chat }),
  backend(/^\/api\/thread\/model$/, { POST: chat }),
  backend(/^\/api\/thread\/sim\/world$/, { POST: { capability: "chat" } }),
  backend(/^\/api\/exec\/simulate$/, { POST: chat }),
  backend(/^\/api\/widget\/v1\/execution-profile$/, { GET: signing }),
  backend(/^\/api\/widget\/v1\/aa-accounts\/[^/]+$/, { PUT: signing }),
  backend(/^\/api\/widget\/v1\/signing-requests\/sign%3A[^/]+$/i, { POST: signing }),
];

/** The resolved need, or "public". */
function needOf(row: Row, requirement: Requirement, request: Request, resources: Resources): Need | "public" {
  if (requirement === "public") return "public";
  if (typeof requirement !== "string") return requirement;
  const scopes = [requirement];
  if (row.paid && request.headers.has("payment-signature")) scopes.push("payments:submit");
  return { resource: resources[row.on!], scopes };
}

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
  const scopes = [...new Set(need.scopes)];
  if (need.scopes.some((scope) => DELEGATING_SCOPES.includes(scope)) && held.includes("custody:delegate"))
    scopes.push("custody:delegate");
  return scopes;
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

function mintToken(ctx: PortalContext, request: Request, claims: Parameters<ReturnType<typeof edgeService>["mint"]>[0]) {
  return minted(() => edgeService(ctx.env, new URL(request.url).host).mint(claims));
}

function mint(ctx: PortalContext, request: Request, claims: Parameters<ReturnType<typeof edgeService>["mint"]>[0]) {
  return mintToken(ctx, request, claims).then((token) => token.accessToken);
}

/** The Rust backend's /api, with an account bearer or anonymously, over the ranked pool. */
async function toBackend(row: Row, request: Request, principal: Principal, ctx: PortalContext): Promise<Response> {
  const { pathname, search } = new URL(request.url);
  const bearer =
    "accountId" in principal
      ? await mint(ctx, request, {
          role: "user",
          subject: principal.accountId,
          audience: "aomi-backend",
          ttlSeconds: ACCOUNT_BEARER_TTL_SECONDS,
        })
      : undefined;
  const path = row.rewrite?.(pathname) ?? pathname;
  // The deploy control plane moves to the manager with the same MANAGER_ORIGIN
  // switch the api surface uses; everything else is ranked over the backend pool.
  const { manager } = config(ctx.env);
  const origins = manager && isManagerPath(path) ? [manager] : rankedPool(request, ctx.env);
  const targets = origins.map((origin) => {
    const url = target(origin, path, search);
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
      client_id: oauth?.clientId,
      auth_source: oauth ? "oauth" : "session",
      principal_class: principal.guest ? "guest" : "user",
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

async function serve(row: Row, need: Need | "public", request: Request, ctx: PortalContext): Promise<Response> {
  if (need === "public") return toBackend(row, request, { kind: "none" }, ctx);
  const started = Date.now();
  const principal = await resolvePrincipal(request, need, ctx);
  if (row.to === "mcp" && principal.kind !== "oauth") throw new PrincipalError(401, "invalid_token");
  const scopes = authorize(principal, need, ctx);
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
    const resource = ctx.resources[row.on!];
    // MCP: Rust maps each tools/call to its business scope, so the bearer
    // carries every scope of the grant; the edge never reads the body.
    const minted = row.to === "mcp" ? scopesOn(principal, resource, ctx) : scopes;
    response = await toScopedApi(request, principal, minted, resource, row.to === "payment" ? "payment" : "agent", ctx);
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
  const resource = row.on ? ctx.resources[row.on] : undefined;
  let response: Response;
  if (requirement === undefined)
    // A protected resource answers in its own error shape; the backend allowlist in the plain one.
    response =
      resource && row.to !== "backend"
        ? Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 })
        : Response.json({ error: "not_found" }, { status: 404 });
  else
    try {
      response = await serve(row, needOf(row, requirement, request, ctx.resources), request, ctx);
    } catch (error) {
      const shape = resource && { resource, challengeScopes: row.challengeScopes, jsonRpc: row.to === "mcp" };
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
