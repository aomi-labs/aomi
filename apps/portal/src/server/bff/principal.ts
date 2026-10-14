import "@tanstack/react-start/server-only";
import { getOrCreateAomiUserForBetterAuthSession } from "@aomi-labs/account/account";
import { AOMI_CANONICAL_USER_CLAIM, AOMI_PRINCIPAL_CLASS_CLAIM, aomiOAuthResources, guestScopesForAomiResource } from "@aomi-labs/account/better-auth/core";
import { auth } from "@/server/auth";
import { cookieWriteAllowed } from "@aomi-labs/account/csrf";
import {
  hasWidgetSessionBearer,
  observedWidgetOrigin,
  resolveWidgetSession,
} from "@aomi-labs/account/widget-auth";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import type { JWTPayload } from "jose";

import {
  getBetterAuthSession,
  sessionUserSeed,
  type BetterAuthSession,
} from "@/server/account/session";
import { devToolsAllowed, portalOrigins } from "@/server/env";
import { capabilities, policyFor, type Need } from "./capabilities";
import { isManagedWidgetClientOrigin } from "./cors";

/** Who is calling, from exactly one credential. */
export type Principal =
  | { kind: "none" }
  | {
      kind: "cookie" | "session_bearer";
      accountId: string;
      guest: boolean;
      betterAuthUserId: string;
      session: NonNullable<BetterAuthSession>;
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
    }
  | { kind: "e2e"; accountId: string; guest: false };

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

/**
 * Identify the caller. Each request is judged by one credential: an explicit
 * Authorization header never falls back to a cookie, and a cookie only counts
 * for the portal's own origins. Cookie-authenticated writes must prove they
 * come from those origins (CSRF).
 */
export async function resolvePrincipal(
  request: Request,
  need: Need,
): Promise<Principal> {
  if (hasWidgetSessionBearer(request)) return widgetPrincipal(request);
  if (isOAuthCredential(request)) {
    if (!("resource" in need)) throw new PrincipalError(401, "invalid_token");
    return oauthRequestPrincipal(request, need.resource, need.scopes);
  }
  if (request.headers.has("authorization"))
    return sessionPrincipal(request, "session_bearer");
  const e2e = await devPrincipal(request, need);
  if (e2e) return e2e;
  return sessionPrincipal(request, "cookie");
}

async function widgetPrincipal(request: Request): Promise<Principal> {
  const widget = await resolveWidgetSession({ request });
  if (!widget) throw new PrincipalError(401, "invalid_widget_session");
  const { userId, ...rest } = widget;
  return {
    kind: "widget",
    accountId: userId,
    guest: widget.authMethod === "anonymous",
    ...rest,
  };
}

async function sessionPrincipal(
  request: Request,
  kind: "cookie" | "session_bearer",
): Promise<Principal> {
  const session = await getBetterAuthSession(request);
  const seed = sessionUserSeed(session);
  if (!seed || !session) {
    if (kind === "session_bearer")
      throw new PrincipalError(401, "invalid_token");
    return { kind: "none" };
  }
  if (kind === "cookie") {
    if (!cookieWriteAllowed(request, portalOrigins()))
      throw new PrincipalError(403, "csrf_failed");
    // A cross-site page can make the browser send the cookie on a read too;
    // only the portal's own origins may use it.
    if (!isTrustedOrigin(request)) return { kind: "none" };
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

async function devPrincipal(
  request: Request,
  need: Need,
): Promise<Principal | null> {
  if (!devToolsAllowed()) return null;
  const e2e: Principal = { kind: "e2e", accountId: "", guest: false };
  const covered =
    "capability" in need
      ? capabilities(e2e).includes(need.capability)
      : need.scopes.every((scope) =>
          policyFor(need.resource).allowedScopes.includes(scope),
        );
  if (!covered) return null;
  const { e2eAccountId } = await import("@/server/bff/dev/e2e-wallet");
  const accountId = e2eAccountId(request);
  if (!accountId) return null;
  if (!cookieWriteAllowed(request, portalOrigins()))
    throw new PrincipalError(403, "csrf_failed");
  return { ...e2e, accountId };
}

function isTrustedOrigin(request: Request): boolean {
  const origin = observedWidgetOrigin(request);
  return (
    !origin ||
    origin === new URL(request.url).origin ||
    portalOrigins().includes(origin)
  );
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

let resourceClient:
  | ReturnType<ReturnType<typeof oauthProviderResourceClient>["getActions"]>
  | undefined;

async function oauthRequestPrincipal(
  request: Request,
  resource: string,
  requiredScopes: readonly string[],
): Promise<Principal> {
  if (
    policyFor(resource).dpopBoundAccessTokensRequired &&
    !hasDpopPresentation(request)
  ) {
    throw new PrincipalError(
      401,
      "invalid_token",
      requiredScopes,
      new Headers({
        "www-authenticate": `DPoP error="invalid_token", resource_metadata="${protectedResourceMetadataUrl(resource)}"`,
      }),
    );
  }
  const issuer = aomiOAuthResources().authorizationServerIssuer;
  resourceClient ??= oauthProviderResourceClient(auth).getActions();
  let claims: JWTPayload;
  try {
    claims = await resourceClient.verifyAccessTokenRequest(request, {
      // Pass both values explicitly: the helper otherwise rebuilds the JWKS
      // URL from Better Auth's base path, which separately published 1.7
      // peers can apply twice.
      jwksUrl: `${issuer}/jwks`,
      verifyOptions: { audience: resource, issuer },
      requiredScopes: [...requiredScopes],
      dpop: { signingAlgorithms: ["ES256", "EdDSA"] },
    });
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status);
    const code = String((error as { code?: unknown })?.code ?? "");
    if (status !== 401 && status !== 403 && !/^ERR_(JWT|JWS|JOSE)/.test(code))
      throw error;
    throw new PrincipalError(
      status === 403 ? 403 : 401,
      status === 403 ? "insufficient_scope" : "invalid_token",
      requiredScopes,
      challengeHeaders(error),
    );
  }
  const principal = await oauthPrincipal(claims, resource);
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== new URL(request.url).origin &&
    !portalOrigins().includes(origin) &&
    !(await isManagedWidgetClientOrigin(origin, principal.clientId))
  )
    throw new PrincipalError(401, "invalid_token");
  return principal;
}

/** The principal an OAuth access token's verified claims describe. */
export async function oauthPrincipal(
  claims: JWTPayload,
  resource: string,
): Promise<Extract<Principal, { kind: "oauth" }>> {
  const accountId = claims[AOMI_CANONICAL_USER_CLAIM];
  const principalClass = claims[AOMI_PRINCIPAL_CLASS_CLAIM];
  if (
    typeof claims.sub !== "string" ||
    claims.iss !== aomiOAuthResources().authorizationServerIssuer ||
    claims.aud !== resource ||
    typeof accountId !== "string" ||
    (principalClass !== "user" && principalClass !== "guest")
  )
    throw new PrincipalError(401, "invalid_token");
  const account = await getOrCreateAomiUserForBetterAuthSession({
    betterAuthUserId: claims.sub,
  });
  if (account.id !== accountId) throw new PrincipalError(401, "invalid_token");
  const scopes = String(claims.scope ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const guest = principalClass === "guest";
  if (
    guest &&
    guestScopesForAomiResource(resource, scopes).length !== scopes.length
  )
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

export function protectedResourceMetadataUrl(resource: string): string {
  return new URL(
    `/.well-known/oauth-protected-resource${new URL(resource).pathname}`,
    resource,
  ).toString();
}

function hasDpopPresentation(request: Request): boolean {
  return (
    /^dpop\s/i.test(request.headers.get("authorization")?.trim() ?? "") &&
    request.headers.has("dpop")
  );
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function challengeHeaders(error: unknown): Headers {
  const headers = (error as { headers?: unknown })?.headers;
  try {
    return new Headers((headers ?? undefined) as HeadersInit | undefined);
  } catch {
    return new Headers();
  }
}
