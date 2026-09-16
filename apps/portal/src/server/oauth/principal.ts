import "server-only";

import { auth } from "@aomi-labs/account/better-auth";
import {
  AOMI_CANONICAL_USER_CLAIM,
  AOMI_PRINCIPAL_CLASS_CLAIM,
} from "@aomi-labs/account/better-auth";
import { getOrCreateAomiUserForBetterAuthSession } from "@aomi-labs/account/account";
import {
  hasWidgetSessionBearer,
  resolveWidgetSession,
} from "@aomi-labs/account/widget-auth";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import type { JWTPayload } from "jose";

import { getBetterAuthSession } from "@portal/server/account/session";
import { resolveE2ECanonicalUserId } from "@portal/server/e2e-wallet";
import { isManagedWidgetClientOrigin } from "./cors";
import { isGuestRestEnabled } from "./features";
import {
  aomiOAuthResourcePolicy,
  aomiOAuthResources,
  guestScopesForAomiResource,
  type AomiPublicResource,
} from "./resources";

export type ApiPrincipal = {
  canonicalUserId: string;
  scopes: readonly string[];
  resource: AomiPublicResource;
  clientId?: string;
  authSource: "oauth" | "session";
  principalClass: "user" | "guest";
  grantId?: string;
  sid?: string;
  widgetOrigin?: string;
};

export class ApiPrincipalError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "invalid_token" | "insufficient_scope" | "csrf_failed",
    readonly requiredScopes: readonly string[] = [],
    readonly challengeHeaders: Headers = new Headers(),
  ) {
    super(code);
  }
}

const resourceClient = oauthProviderResourceClient(auth).getActions();

export function isOAuthCredential(request: Request): boolean {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const [scheme, credential] = authorization.split(/\s+/, 2);
  return (
    scheme?.toLowerCase() === "dpop" ||
    (scheme?.toLowerCase() === "bearer" && credential?.split(".").length === 3)
  );
}

export async function resolveApiPrincipal(input: {
  request: Request;
  resource: AomiPublicResource;
  requiredScopes: readonly string[];
  sessionScopes: readonly string[];
}): Promise<ApiPrincipal> {
  const e2eCanonicalUserId = resolveE2ECanonicalUserId(input.request);
  if (e2eCanonicalUserId) {
    enforceCookieCsrf(input.request);
    return {
      canonicalUserId: e2eCanonicalUserId,
      scopes: [...input.sessionScopes],
      resource: input.resource,
      authSource: "session",
      principalClass: "user",
      sid: "e2e-session",
    };
  }
  if (hasWidgetSessionBearer(input.request)) {
    const widget = await resolveWidgetSession({ request: input.request });
    if (!widget) throw new ApiPrincipalError(401, "invalid_token");
    const isAnonymousWidget = widget.authMethod === "anonymous";
    const allowedSessionScopes = isAnonymousWidget
      ? guestScopes(input.resource, input.sessionScopes)
      : input.sessionScopes;
    for (const required of input.requiredScopes) {
      if (!allowedSessionScopes.includes(required)) {
        throw new ApiPrincipalError(
          403,
          "insufficient_scope",
          input.requiredScopes,
        );
      }
    }
    const scopes = [...new Set(input.requiredScopes)];
    // A widget that can create an agent turn also needs to resolve that
    // turn's staged action. The guest ceiling permits that self-custodial
    // continuation while still excluding custody, payment, and MCP scopes.
    if (
      input.requiredScopes.includes("agent:write") &&
      allowedSessionScopes.includes("agent:actions:resolve")
    ) {
      scopes.push("agent:actions:resolve");
    }
    return {
      canonicalUserId: widget.userId,
      // A widget session authorizes only the operation currently being
      // requested. It never inherits elevated OAuth scopes such as delegated
      // custody merely because the canonical account has those capabilities.
      scopes,
      resource: input.resource,
      authSource: "session",
      principalClass: isAnonymousWidget ? "guest" : "user",
      sid: "widget-session",
      widgetOrigin: widget.origin,
    };
  }
  if (isOAuthCredential(input.request)) {
    const policy = aomiOAuthResourcePolicy(input.resource);
    if (
      policy?.dpopBoundAccessTokensRequired &&
      !hasDpopPresentation(input.request)
    ) {
      throw new ApiPrincipalError(
        401,
        "invalid_token",
        input.requiredScopes,
        new Headers({
          "www-authenticate": `DPoP error="invalid_token", resource_metadata="${protectedMetadataUrl(input.resource)}"`,
        }),
      );
    }
    let claims: JWTPayload;
    try {
      claims = await resourceClient.verifyAccessTokenRequest(input.request, {
        // Pass both values explicitly. The resource-client helper otherwise
        // reconstructs the JWKS URL from Better Auth's base URL/base path;
        // separately published 1.7 peer contexts can apply that path twice.
        jwksUrl: `${aomiOAuthResources().authorizationServerIssuer}/jwks`,
        verifyOptions: {
          audience: input.resource,
          issuer: aomiOAuthResources().authorizationServerIssuer,
        },
        requiredScopes: input.requiredScopes,
        dpop: { signingAlgorithms: ["ES256", "EdDSA"] },
      });
    } catch (error) {
      const status =
        typeof error === "object" && error && "status" in error
          ? Number(error.status)
          : 401;
      throw new ApiPrincipalError(
        status === 403 ? 403 : 401,
        status === 403 ? "insufficient_scope" : "invalid_token",
        input.requiredScopes,
        challengeHeaders(error),
      );
    }
    const principal = await principalFromOAuthClaims(claims, input.resource);
    const session = await getBetterAuthSession(input.request);
    if (session?.user?.id) {
      const sessionCanonical = await getOrCreateAomiUserForBetterAuthSession({
        betterAuthUserId: session.user.id,
      });
      if (sessionCanonical.id !== principal.canonicalUserId) {
        throw new ApiPrincipalError(401, "invalid_token");
      }
    }
    if (
      principal.principalClass === "guest" &&
      !isGuestRestEnabled(input.resource)
    ) {
      throw new ApiPrincipalError(
        403,
        "insufficient_scope",
        input.requiredScopes,
      );
    }
    const origin = input.request.headers.get("origin");
    if (
      origin &&
      origin !== aomiOAuthResources().portalOrigin &&
      !(await isManagedWidgetClientOrigin(origin, principal.clientId))
    ) {
      throw new ApiPrincipalError(401, "invalid_token");
    }
    return principal;
  }

  const origin = input.request.headers.get("origin");
  if (
    !input.request.headers.has("authorization") &&
    origin &&
    origin !== aomiOAuthResources().portalOrigin
  ) {
    throw new ApiPrincipalError(401, "invalid_token");
  }

  // A non-JWT bearer is a Better Auth session token: the bearer plugin lets
  // getSession resolve it, which is how guest/SDK clients (no cookie
  // cross-origin) carry their session. An unresolvable credential still lands
  // on the trailing 401.
  const session = await getBetterAuthSession(input.request);
  if (session?.user?.id) {
    // Cookie-carried sessions are browser-ambient and need CSRF proof; a
    // request bearing an Authorization header cannot be forged cross-site
    // (custom headers force a CORS preflight), so it passes without one.
    if (!input.request.headers.has("authorization")) {
      enforceCookieCsrf(input.request);
    }
    const canonical = await getOrCreateAomiUserForBetterAuthSession({
      betterAuthUserId: session.user.id,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      name: session.user.name,
      avatarUrl: session.user.image,
    });
    const principalClass = session.user.isAnonymous === true ? "guest" : "user";
    if (principalClass === "guest" && !isGuestRestEnabled(input.resource)) {
      throw new ApiPrincipalError(
        403,
        "insufficient_scope",
        input.requiredScopes,
      );
    }
    const scopes =
      principalClass === "guest"
        ? guestScopes(input.resource, input.sessionScopes)
        : [...input.sessionScopes];
    for (const required of input.requiredScopes) {
      if (!scopes.includes(required)) {
        throw new ApiPrincipalError(
          403,
          "insufficient_scope",
          input.requiredScopes,
        );
      }
    }
    return {
      canonicalUserId: canonical.id,
      scopes,
      resource: input.resource,
      authSource: "session",
      principalClass,
      sid: session.session ? "session" : undefined,
    };
  }
  // Better Auth's bearer plugin deliberately accepts opaque session tokens
  // for headless clients such as the CLI. JWT-shaped OAuth credentials and
  // WSTs have already failed closed in their dedicated branches above, so an
  // unresolved Authorization header here is invalid rather than a cookie
  // fallback candidate.
  if (input.request.headers.has("authorization")) {
    throw new ApiPrincipalError(401, "invalid_token");
  }
  throw new ApiPrincipalError(401, "invalid_token");
}

export async function principalFromOAuthClaims(
  claims: JWTPayload,
  resource: AomiPublicResource,
): Promise<ApiPrincipal> {
  const canonicalClaim = claims[AOMI_CANONICAL_USER_CLAIM];
  const principalClassClaim = claims[AOMI_PRINCIPAL_CLASS_CLAIM];
  if (
    typeof claims.sub !== "string" ||
    claims.iss !== aomiOAuthResources().authorizationServerIssuer ||
    Array.isArray(claims.aud) ||
    claims.aud !== resource ||
    typeof canonicalClaim !== "string" ||
    !["user", "guest"].includes(String(principalClassClaim))
  ) {
    throw new ApiPrincipalError(401, "invalid_token");
  }
  const defensive = await getOrCreateAomiUserForBetterAuthSession({
    betterAuthUserId: claims.sub,
  });
  if (defensive.id !== canonicalClaim) {
    console.warn("oauth canonical identity disagreement", {
      clientId: stringClaim(claims.client_id) ?? stringClaim(claims.azp),
    });
    throw new ApiPrincipalError(401, "invalid_token");
  }
  const scopes = String(claims.scope ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const principalClass = principalClassClaim as "user" | "guest";
  const boundedScopes =
    principalClass === "guest" ? guestScopes(resource, scopes) : scopes;
  if (boundedScopes.length !== scopes.length) {
    throw new ApiPrincipalError(403, "insufficient_scope", boundedScopes);
  }
  return {
    canonicalUserId: canonicalClaim,
    scopes: boundedScopes,
    resource,
    clientId: stringClaim(claims.client_id) ?? stringClaim(claims.azp),
    authSource: "oauth",
    principalClass,
    grantId: stringClaim(claims.jti),
    sid: stringClaim(claims.sid),
  };
}

function guestScopes(resource: AomiPublicResource, scopes: readonly string[]) {
  return guestScopesForAomiResource(resource, scopes);
}

function enforceCookieCsrf(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.has("authorization")) return;
  const origin = request.headers.get("origin");
  const expected = new Set([
    new URL(request.url).origin,
    aomiOAuthResources().portalOrigin,
  ]);
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",", 1)[0]
    ?.trim();
  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() ??
    "https";
  if (forwardedHost) expected.add(`${forwardedProto}://${forwardedHost}`);
  if (origin) {
    if (!expected.has(origin)) {
      throw new ApiPrincipalError(403, "csrf_failed");
    }
    return;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw new ApiPrincipalError(403, "csrf_failed");
  }
  if (request.headers.get("x-aomi-csrf") === "1") return;

  // Some browsers omit Origin for same-origin fetches. Fetch Metadata is set
  // by the browser and cannot be forged by a cross-site page, so it is a safe
  // fallback while requests without either signal remain denied.
  if (fetchSite !== "same-origin") {
    throw new ApiPrincipalError(403, "csrf_failed");
  }
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function apiAuthError(
  error: unknown,
  resource: AomiPublicResource,
): Response {
  const principalError =
    error instanceof ApiPrincipalError
      ? error
      : new ApiPrincipalError(401, "invalid_token");
  const metadata = protectedMetadataUrl(resource);
  const params = [
    `resource_metadata="${metadata}"`,
    `error="${principalError.code}"`,
    principalError.requiredScopes.length
      ? `scope="${principalError.requiredScopes.join(" ")}"`
      : null,
  ].filter(Boolean);
  const headers = new Headers(principalError.challengeHeaders);
  if (!headers.has("www-authenticate")) {
    headers.set("www-authenticate", `Bearer ${params.join(", ")}`);
  }
  return Response.json(
    { error: { code: principalError.code, message: "Authorization failed" } },
    {
      status: principalError.status,
      headers,
    },
  );
}

function hasDpopPresentation(request: Request): boolean {
  return (
    request.headers
      .get("authorization")
      ?.trim()
      .toLowerCase()
      .startsWith("dpop ") === true && request.headers.has("dpop")
  );
}

function protectedMetadataUrl(resource: AomiPublicResource): string {
  return new URL(
    `/.well-known/oauth-protected-resource${new URL(resource).pathname}`,
    resource,
  ).toString();
}

function challengeHeaders(error: unknown): Headers {
  if (!error || typeof error !== "object" || !("headers" in error)) {
    return new Headers();
  }
  const value = error.headers;
  try {
    return value instanceof Headers
      ? new Headers(value)
      : new Headers(value as HeadersInit);
  } catch {
    return new Headers();
  }
}
