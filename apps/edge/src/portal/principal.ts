import { errors as joseErrors, jwtVerify, type JWTPayload } from "jose";

import { getOrCreateAomiUserForBetterAuthSession } from "@aomi-labs/account/account";
import { readManagedOAuthClient } from "@aomi-labs/account/better-auth";
import { cookieWriteAllowed } from "@aomi-labs/account/csrf";
import {
  acceptsApiToken,
  authorize as decide,
  AOMI_CANONICAL_USER_CLAIM,
  AOMI_PRINCIPAL_CLASS_CLAIM,
  guestScopesFor,
  scopesOn as heldScopes,
  type Need,
} from "@aomi-labs/account/policy";
import {
  hasWidgetSessionBearer,
  isOAuthCredential,
  type Principal,
  type PrincipalCode,
} from "@aomi-labs/account/principal";
import { resolveWidgetSession } from "@aomi-labs/account/widget-auth";

import { getBetterAuthSession, sessionUserSeed } from "../auth/server";
import { EdgeError } from "../kernel/errors";
import { observedOrigin } from "../kernel/cors";
import { DpopError, DPOP_SIGNING_ALGORITHMS, verifyDpopProof } from "./dpop";
import { JwksUnavailableError, portalJwks } from "./jwks";
import { policyFor, type PortalContext } from "./context";

export type { Principal };

export class PrincipalError extends EdgeError {
  constructor(
    readonly status: 401 | 403,
    readonly code: PrincipalCode,
    readonly requiredScopes: readonly string[] = [],
    challengeHeaders: HeadersInit = {},
  ) {
    super(status, code, { headers: challengeHeaders });
    this.name = "PrincipalError";
  }
}

/** The signing keys could not be read. */
const authUnavailable = (cause: unknown) => new EdgeError(502, "auth_unavailable", { cause });

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
  if (hasWidgetSessionBearer(request)) return widgetPrincipal(request);
  if (isOAuthCredential(request)) {
    if (!("resource" in need)) throw new PrincipalError(401, "invalid_token");
    return oauthRequestPrincipal(request, need.resource, need.scopes, ctx);
  }
  if (request.headers.has("authorization"))
    return sessionPrincipal(request, "session_bearer", ctx);
  return sessionPrincipal(request, "cookie", ctx);
}

async function widgetPrincipal(request: Request): Promise<Principal> {
  const origin = observedOrigin(request);
  const widget = origin ? await resolveWidgetSession({ request }) : null;
  if (!widget) throw new PrincipalError(401, "invalid_widget_session");
  return {
    kind: "widget",
    accountId: widget.userId,
    guest: widget.authMethod === "anonymous",
    origin: widget.origin,
    authMethod: widget.authMethod,
    expiresAt: widget.expiresAt,
    providerIdentityId: widget.providerIdentityId,
  };
}

async function sessionPrincipal(
  request: Request,
  kind: "cookie" | "session_bearer",
  ctx: PortalContext,
): Promise<Principal> {
  if (kind === "cookie" && !request.headers.has("cookie")) return { kind: "none" };
  const session = await getBetterAuthSession(ctx.auth(), request);
  const seed = sessionUserSeed(session);
  if (!seed || !session) {
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
  const account = await getOrCreateAomiUserForBetterAuthSession(seed);
  return {
    kind,
    accountId: account.id,
    guest: session.user?.isAnonymous === true,
    betterAuthUserId: seed.betterAuthUserId,
    session,
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

async function verifyWithJwks(
  token: string,
  ctx: PortalContext,
  options: { issuer: string; audience: string | string[] },
): Promise<JWTPayload> {
  // The keys come from Better Auth in this Worker, cached in the isolate and KV.
  const base = {
    fetchImpl: (input: Request) => ctx.auth().handler(input),
    cache: ctx.env.EDGE_CACHE,
    now: ctx.now,
    jwksUrl: `${ctx.portalOrigin}/api/auth/jwks`,
  };
  const verify = async (fresh: boolean) =>
    (await jwtVerify(token, await portalJwks({ ...base, fresh }), { ...options, currentDate: new Date(ctx.now()) }))
      .payload;
  try {
    return await verify(false);
  } catch (error) {
    // A key the cached set has not seen: refresh once before giving up.
    if (error instanceof joseErrors.JWKSNoMatchingKey) return verify(true);
    throw error;
  }
}

async function oauthRequestPrincipal(
  request: Request,
  resource: string,
  requiredScopes: readonly string[],
  ctx: PortalContext,
): Promise<Principal> {
  const policy = policyFor(resource, ctx);
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
      audience: audiences(resource, ctx),
    });
  } catch (error) {
    if (error instanceof JwksUnavailableError) throw authUnavailable(error);
    throw new PrincipalError(401, "invalid_token", requiredScopes, bearerChallenge(resource));
  }
  const granted = grantedScopes(claims, resource, ctx);
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
    !(await isManagedWidgetClientOrigin(origin, principal.clientId))
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

/**
 * The audiences a resource takes: its own, and for the three REST APIs also
 * `/v1`, the one sign-in Aomi's CLI and SDK use. MCP servers take only theirs.
 */
function audiences(resource: string, ctx: PortalContext): string[] {
  return acceptsApiToken(policyFor(resource, ctx)) ? [resource, ctx.resources.apiRest] : [resource];
}

/** A token's scopes on this resource: a `/v1` token carries every REST scope, and a route only gets its own. */
function grantedScopes(claims: JWTPayload, resource: string, ctx: PortalContext): string[] {
  const granted = String(claims.scope ?? "").split(/\s+/).filter(Boolean);
  if (claims.aud === resource) return granted;
  const grantable = policyFor(resource, ctx).grantableScopes;
  return granted.filter((scope) => grantable.includes(scope));
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
    typeof claims.aud !== "string" ||
    !audiences(resource, ctx).includes(claims.aud) ||
    typeof accountId !== "string" ||
    (principalClass !== "user" && principalClass !== "guest")
  )
    throw new PrincipalError(401, "invalid_token");
  const scopes = grantedScopes(claims, resource, ctx);
  const guest = principalClass === "guest";
  const policy = policyFor(resource, ctx);
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

/** Whether a registered partner widget may call from this exact origin. */
export async function isManagedWidgetClientOrigin(
  origin: string | null,
  clientId: string | undefined,
): Promise<boolean> {
  if (!origin || !clientId) return false;
  const client = await readManagedOAuthClient(clientId);
  return Boolean(
    client &&
      !client.disabled &&
      client.clientClass === "partner_widget" &&
      client.origins.includes(origin),
  );
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
