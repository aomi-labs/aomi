import { errors as joseErrors, jwtVerify, type JWTPayload } from "jose";

import type { PortalContext } from "./context";
import { cookieWriteAllowed, observedOrigin } from "./csrf";
import { DpopError, DPOP_SIGNING_ALGORITHMS, verifyDpopProof } from "./dpop";
import { JwksUnavailableError, portalJwks } from "./jwks";
import {
  AOMI_CANONICAL_USER_CLAIM,
  AOMI_PRINCIPAL_CLASS_CLAIM,
  guestScopesFor,
  policyFor,
  type Need,
  type SessionKind,
} from "./policy";

/** Who is calling, from exactly one credential. */
export type Principal =
  | { kind: "none" }
  | {
      kind: "cookie" | "session_bearer";
      accountId: string;
      guest: boolean;
      betterAuthUserId?: string;
    }
  | {
      kind: "widget";
      accountId: string;
      guest: boolean;
      origin: string;
      authMethod: string;
      expiresAt: number;
      providerIdentityId?: string;
    }
  | {
      kind: "oauth";
      accountId: string;
      guest: boolean;
      resource: string;
      scopes: readonly string[];
      clientId?: string;
      grantId?: string;
      sessionBound: boolean;
    };

export type PrincipalCode =
  | "invalid_token"
  | "invalid_widget_session"
  | "insufficient_scope"
  | "csrf_failed"
  | "unauthenticated";

export class PrincipalError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: PrincipalCode,
    readonly requiredScopes: readonly string[] = [],
    readonly challengeHeaders: Headers = new Headers(),
  ) {
    super(code);
    this.name = "PrincipalError";
  }
}

/** The portal could not be asked who the caller is. */
export class PrincipalUpstreamError extends Error {
  constructor(cause: unknown) {
    super("principal_upstream_unavailable", { cause });
    this.name = "PrincipalUpstreamError";
  }
}

export const WIDGET_TOKEN_PREFIX = "aomi_wst_";
/** The portal signs principal tokens for this audience and nobody else. */
export const PRINCIPAL_TOKEN_AUDIENCE = "aomi-edge";
export const PRINCIPAL_PATH = "/api/auth/edge/principal";
export const MANAGED_ORIGIN_PATH = "/api/auth/edge/managed-origin";
const MANAGED_ORIGIN_TTL_MS = 5 * 60 * 1000;

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) return null;
  return token;
}

export function hasWidgetSessionBearer(request: Request): boolean {
  return bearerToken(request)?.startsWith(WIDGET_TOKEN_PREFIX) ?? false;
}

export function isOAuthCredential(request: Request): boolean {
  const [scheme, credential] = (request.headers.get("authorization") ?? "")
    .trim()
    .split(/\s+/, 2);
  return (
    scheme?.toLowerCase() === "dpop" ||
    (scheme?.toLowerCase() === "bearer" && credential?.split(".").length === 3)
  );
}

function hasDpopPresentation(request: Request): boolean {
  return (
    /^dpop\s/i.test(request.headers.get("authorization")?.trim() ?? "") &&
    request.headers.has("dpop")
  );
}

export function protectedResourceMetadataUrl(resource: string): string {
  return new URL(
    `/.well-known/oauth-protected-resource${new URL(resource).pathname}`,
    resource,
  ).toString();
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Identify the caller. Each request is judged by one credential: an explicit
 * Authorization header never falls back to a cookie, and a cookie only counts
 * for the portal's own origins. Cookie-authenticated writes must prove they
 * come from those origins (CSRF).
 */
export async function resolvePrincipal(
  request: Request,
  need: Need,
  ctx: PortalContext,
): Promise<Principal> {
  if (hasWidgetSessionBearer(request)) return widgetPrincipal(request, ctx);
  if (isOAuthCredential(request)) {
    if (!("resource" in need)) throw new PrincipalError(401, "invalid_token");
    return oauthRequestPrincipal(request, need.resource, need.scopes, ctx);
  }
  if (request.headers.has("authorization"))
    return sessionPrincipal(request, "session_bearer", ctx);
  return sessionPrincipal(request, "cookie", ctx);
}

async function widgetPrincipal(request: Request, ctx: PortalContext): Promise<Principal> {
  const origin = observedOrigin(request);
  if (!origin) throw new PrincipalError(401, "invalid_widget_session");
  const claims = await exchangePrincipal(request, "widget", ctx);
  if (!claims) throw new PrincipalError(401, "invalid_widget_session");
  if (claims.kind !== "widget" || claims.origin !== origin)
    throw new PrincipalError(401, "invalid_widget_session");
  return {
    kind: "widget",
    accountId: claims.sub,
    guest: claims.guest,
    origin,
    authMethod: claims.auth_method ?? "unknown",
    expiresAt: claims.expires_at ?? claims.exp,
    providerIdentityId: claims.provider_identity_id,
  };
}

async function sessionPrincipal(
  request: Request,
  kind: "cookie" | "session_bearer",
  ctx: PortalContext,
): Promise<Principal> {
  if (kind === "cookie" && !request.headers.has("cookie")) return { kind: "none" };
  const claims = await exchangePrincipal(request, kind, ctx);
  if (!claims) {
    if (kind === "session_bearer") throw new PrincipalError(401, "invalid_token");
    return { kind: "none" };
  }
  if (kind === "cookie") {
    if (!cookieWriteAllowed(request, ctx.trustedOrigins))
      throw new PrincipalError(403, "csrf_failed");
    // A cross-site page can make the browser send the cookie on a read too;
    // only the portal's own origins may use it.
    if (!isTrustedOrigin(request, ctx)) return { kind: "none" };
  }
  return {
    kind,
    accountId: claims.sub,
    guest: claims.guest,
    betterAuthUserId: claims.better_auth_user_id,
  };
}

function isTrustedOrigin(request: Request, ctx: PortalContext): boolean {
  const origin = observedOrigin(request);
  return (
    !origin ||
    origin === new URL(request.url).origin ||
    ctx.trustedOrigins.includes(origin)
  );
}

/** The claims the portal's principal token carries. */
export type PrincipalTokenClaims = JWTPayload & {
  sub: string;
  exp: number;
  kind: SessionKind;
  guest: boolean;
  origin?: string;
  auth_method?: string;
  expires_at?: number;
  provider_identity_id?: string;
  better_auth_user_id?: string;
};

type Exchange = { token: string; expiresAtMs: number };
const exchanges = new Map<string, Exchange>();
const managedOrigins = new Map<string, { allowed: boolean; checkedAt: number }>();

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Turn the credential a browser or widget presents into the portal's signed
 * principal token: the portal (which has the database) says who the cookie,
 * session bearer or widget session belongs to, signs it for five minutes, and
 * the edge verifies that statement against the portal JWKS and remembers it
 * until it expires. Revocation takes effect at the next exchange.
 */
async function exchangePrincipal(
  request: Request,
  kind: SessionKind,
  ctx: PortalContext,
): Promise<PrincipalTokenClaims | null> {
  const credential =
    kind === "cookie"
      ? request.headers.get("cookie") ?? ""
      : request.headers.get("authorization") ?? "";
  const origin = kind === "widget" ? observedOrigin(request) ?? "" : "";
  const key = `principal:v1:${kind}:${await sha256Hex(`${credential}\n${origin}`)}`;
  const nowMs = ctx.now();
  let token: string | null = null;
  const cached = exchanges.get(key);
  if (cached && cached.expiresAtMs > nowMs) {
    token = cached.token;
  } else {
    const stored = await ctx.env.EDGE_CACHE?.get(key).catch(() => null);
    if (stored) token = stored;
  }
  if (!token) {
    const headers = new Headers({
      accept: "application/json",
      "x-forwarded-host": new URL(request.url).host,
    });
    if (kind === "cookie") headers.set("cookie", credential);
    else headers.set("authorization", credential);
    if (origin) headers.set("origin", origin);
    let response: Response;
    try {
      response = await ctx.fetchImpl(
        new Request(`${ctx.upstreamOrigin}${PRINCIPAL_PATH}`, { method: "POST", headers }),
        { cache: "no-store" },
      );
    } catch (error) {
      throw new PrincipalUpstreamError(error);
    }
    if (response.status === 204) return null;
    if (response.status === 401 || response.status === 403) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      const code = typeof body?.error === "string" ? body.error : "invalid_token";
      throw new PrincipalError(
        response.status,
        isPrincipalCode(code) ? code : "invalid_token",
      );
    }
    if (!response.ok) throw new PrincipalUpstreamError(new Error(`principal ${response.status}`));
    const body = (await response.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token !== "string") throw new PrincipalUpstreamError(new Error("no token"));
    token = body.token;
  }
  const claims = await verifyPrincipalToken(token, ctx);
  // A principal is good until its own signature lapses or the credential it
  // describes expires, whichever comes first (KV keeps entries at least a
  // minute, so a widget session's end is checked here, not left to the cache).
  const expiresAtMs = Math.min(claims.exp, claims.expires_at ?? claims.exp) * 1000;
  if (expiresAtMs <= nowMs) {
    exchanges.delete(key);
    await ctx.env.EDGE_CACHE?.delete(key).catch(() => undefined);
    throw new PrincipalError(401, kind === "widget" ? "invalid_widget_session" : "invalid_token");
  }
  const ttlMs = expiresAtMs - nowMs;
  if (ttlMs > 1000) {
    exchanges.set(key, { token, expiresAtMs });
    await ctx.env.EDGE_CACHE?.put(key, token, {
      expirationTtl: Math.max(60, Math.floor(ttlMs / 1000)),
    }).catch(() => undefined);
  }
  return claims;
}

function isPrincipalCode(value: string): value is PrincipalCode {
  return [
    "invalid_token",
    "invalid_widget_session",
    "insufficient_scope",
    "csrf_failed",
    "unauthenticated",
  ].includes(value);
}

async function verifyWithJwks(
  token: string,
  ctx: PortalContext,
  options: { issuer: string; audience: string },
): Promise<JWTPayload> {
  const jwksUrl = `${ctx.upstreamOrigin}/api/auth/jwks`;
  const base = { fetchImpl: ctx.fetchImpl, cache: ctx.env.EDGE_CACHE, now: ctx.now, jwksUrl };
  try {
    return (await jwtVerify(token, await portalJwks(base), { ...options, currentDate: new Date(ctx.now()) })).payload;
  } catch (error) {
    if (error instanceof joseErrors.JWKSNoMatchingKey) {
      // A key the cached set has not seen: refresh once before giving up.
      return (
        await jwtVerify(token, await portalJwks({ ...base, fresh: true }), {
          ...options,
          currentDate: new Date(ctx.now()),
        })
      ).payload;
    }
    throw error;
  }
}

async function verifyPrincipalToken(token: string, ctx: PortalContext): Promise<PrincipalTokenClaims> {
  let payload: JWTPayload;
  try {
    payload = await verifyWithJwks(token, ctx, {
      issuer: ctx.resources.authorizationServerIssuer,
      audience: PRINCIPAL_TOKEN_AUDIENCE,
    });
  } catch (error) {
    if (error instanceof JwksUnavailableError) throw new PrincipalUpstreamError(error);
    throw new PrincipalUpstreamError(error);
  }
  const kind = payload.kind;
  if (
    typeof payload.sub !== "string" ||
    typeof payload.exp !== "number" ||
    (kind !== "cookie" && kind !== "session_bearer" && kind !== "widget") ||
    typeof payload.guest !== "boolean"
  )
    throw new PrincipalUpstreamError(new Error("malformed principal token"));
  return payload as PrincipalTokenClaims;
}

async function oauthRequestPrincipal(
  request: Request,
  resource: string,
  requiredScopes: readonly string[],
  ctx: PortalContext,
): Promise<Principal> {
  const policy = policyFor(resource, ctx.resources, ctx.dpopRequired);
  if (policy.dpopBoundAccessTokensRequired && !hasDpopPresentation(request)) {
    throw new PrincipalError(
      401,
      "invalid_token",
      requiredScopes,
      new Headers({
        "www-authenticate": `DPoP error="invalid_token", resource_metadata="${protectedResourceMetadataUrl(resource)}"`,
      }),
    );
  }
  const [scheme, token] = (request.headers.get("authorization") ?? "").trim().split(/\s+/, 2);
  let claims: JWTPayload;
  try {
    claims = await verifyWithJwks(token ?? "", ctx, {
      issuer: ctx.resources.authorizationServerIssuer,
      audience: resource,
    });
  } catch (error) {
    if (error instanceof JwksUnavailableError) throw new PrincipalUpstreamError(error);
    throw new PrincipalError(401, "invalid_token", requiredScopes, bearerChallenge(resource));
  }
  const granted = String(claims.scope ?? "").split(/\s+/).filter(Boolean);
  if (requiredScopes.some((scope) => !granted.includes(scope)))
    throw new PrincipalError(403, "insufficient_scope", requiredScopes);
  const cnf = claims.cnf as { jkt?: unknown } | undefined;
  if (scheme?.toLowerCase() === "dpop" || typeof cnf?.jkt === "string") {
    const proof = request.headers.get("dpop");
    if (!proof || scheme?.toLowerCase() !== "dpop")
      throw dpopChallenge(new DpopError("DPoP-bound token requires a DPoP proof"), requiredScopes);
    try {
      await verifyDpopProof({
        proof,
        method: request.method,
        url: request.url,
        accessToken: token ?? "",
        accessTokenClaims: claims,
        now: ctx.now,
      });
    } catch (error) {
      if (error instanceof DpopError) throw dpopChallenge(error, requiredScopes);
      throw error;
    }
  }
  const principal = oauthPrincipal(claims, resource, ctx);
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== new URL(request.url).origin &&
    !ctx.trustedOrigins.includes(origin) &&
    !(await isManagedWidgetClientOrigin(origin, principal.clientId, ctx))
  )
    throw new PrincipalError(401, "invalid_token");
  return principal;
}

function bearerChallenge(resource: string, scopes: readonly string[] = []): Headers {
  const scope = scopes.length ? `, scope="${[...new Set(scopes)].join(" ")}"` : "";
  return new Headers({
    "www-authenticate": `Bearer resource_metadata="${protectedResourceMetadataUrl(resource)}"${scope}`,
  });
}

function dpopChallenge(error: DpopError, requiredScopes: readonly string[]): PrincipalError {
  return new PrincipalError(
    401,
    "invalid_token",
    requiredScopes,
    new Headers({
      "www-authenticate": `DPoP error="invalid_dpop_proof", error_description="${error.description}", algs="${DPOP_SIGNING_ALGORITHMS.join(" ")}"`,
    }),
  );
}

/** The principal an OAuth access token's verified claims describe. */
export function oauthPrincipal(
  claims: JWTPayload,
  resource: string,
  ctx: PortalContext,
): Extract<Principal, { kind: "oauth" }> {
  const accountId = claims[AOMI_CANONICAL_USER_CLAIM];
  const principalClass = claims[AOMI_PRINCIPAL_CLASS_CLAIM];
  if (
    typeof claims.sub !== "string" ||
    claims.iss !== ctx.resources.authorizationServerIssuer ||
    claims.aud !== resource ||
    typeof accountId !== "string" ||
    (principalClass !== "user" && principalClass !== "guest")
  )
    throw new PrincipalError(401, "invalid_token");
  const scopes = String(claims.scope ?? "").split(/\s+/).filter(Boolean);
  const guest = principalClass === "guest";
  const policy = policyFor(resource, ctx.resources, ctx.dpopRequired);
  if (guest && guestScopesFor(policy, scopes).length !== scopes.length)
    throw new PrincipalError(403, "insufficient_scope");
  return {
    kind: "oauth",
    accountId,
    guest,
    resource,
    scopes,
    clientId: stringClaim(claims.client_id) ?? stringClaim(claims.azp),
    grantId: stringClaim(claims.jti),
    sessionBound: stringClaim(claims.sid) !== undefined,
  };
}

/** Whether a registered partner widget may call from this origin; the portal knows its clients. */
async function isManagedWidgetClientOrigin(
  origin: string,
  clientId: string | undefined,
  ctx: PortalContext,
): Promise<boolean> {
  if (!clientId) return false;
  const key = `${clientId}\n${origin}`;
  const cached = managedOrigins.get(key);
  if (cached && ctx.now() - cached.checkedAt < MANAGED_ORIGIN_TTL_MS) return cached.allowed;
  const url = new URL(`${ctx.upstreamOrigin}${MANAGED_ORIGIN_PATH}`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("origin", origin);
  let allowed = false;
  try {
    const response = await ctx.fetchImpl(
      new Request(url, { headers: { accept: "application/json" } }),
      { cache: "no-store" },
    );
    const body = (await response.json().catch(() => null)) as { allowed?: unknown } | null;
    allowed = response.ok && body?.allowed === true;
  } catch {
    allowed = false;
  }
  managedOrigins.set(key, { allowed, checkedAt: ctx.now() });
  return allowed;
}

export function resetPrincipalCaches(): void {
  exchanges.clear();
  managedOrigins.clear();
}
