/**
 * The portal surface at the edge. `ROUTES` (`@aomi-labs/account/policy`)
 * names every route the edge serves on a portal host: what the caller needs
 * per method and which upstream gets the request. The edge identifies the
 * caller, checks that need, mints the bearer as `aomi-edge` and forwards
 * under a header policy. Account routes (sign-in, the account graph, widget
 * and device auth) are served in-process (`../auth`); anything else passes
 * through to the portal's pages.
 */
import { ROUTES, type Method, type Need, type Route } from "@aomi-labs/account/policy";

import { edgeService } from "../identity";
import { config } from "../kernel/config";
import { openWidget, preflight, publicRead, withCors } from "../kernel/cors";
import { minted, unreachable } from "../kernel/errors";
import { apiOrigins } from "../kernel/manager";
import { rankedPool } from "../kernel/pool";
import { passThrough, proxy, target } from "../kernel/proxy";
import { handleAuthRequest } from "../auth/routes";
import { isPublicCatalogKind, publicCatalog } from "./catalog";
import type { PortalContext } from "./context";
import { portalError } from "./errors";
import { AGENT_API_HEADERS, BACKEND_API_HEADERS, PUBLIC_DISCOVERY_HEADERS } from "./headers";
import type { Principal } from "@aomi-labs/account/principal";
import { authorize, needOf, PrincipalError, resolvePrincipal, resourceOf, scopesOn } from "./principal";

export const ACCOUNT_BEARER_TTL_SECONDS = 15 * 60;

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
async function toBackend(row: Route, request: Request, principal: Principal, ctx: PortalContext): Promise<Response> {
  const { pathname, search } = new URL(request.url);
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
  row: Route,
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
async function served(rows: readonly Route[], request: Request, ctx: PortalContext): Promise<Response> {
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
  const account = await handleAuthRequest(request, ctx);
  if (account) return account;
  if (pathname === "/.well-known/api-catalog") return discovery(request, ctx);
  const catalogKind = /^\/api\/public\/catalog\/([^/]+)$/.exec(pathname)?.[1];
  if (catalogKind) return catalog(request, catalogKind, ctx);
  const rows = ROUTES.filter((row) => row.path.test(pathname));
  if (rows.length) return served(rows, request, ctx);
  return passThrough(request, ctx.upstreamOrigin, ctx.fetchImpl, "portal");
}
