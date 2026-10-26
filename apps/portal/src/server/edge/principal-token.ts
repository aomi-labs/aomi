import "server-only";
import { getOrCreateAomiUserForBetterAuthSession } from "@aomi-labs/account/account";
import { auth } from "@aomi-labs/account/better-auth";
import {
  hasWidgetSessionBearer,
  resolveWidgetSession,
} from "@aomi-labs/account/widget-auth";

import { getBetterAuthSession, sessionUserSeed } from "@/server/account/session";
import { isManagedWidgetClientOrigin } from "@/server/bff/cors";

/**
 * The portal as identity root for the edge. The Worker cannot read Postgres,
 * so it hands the credential a caller presented (session cookie, Better Auth
 * bearer or widget session token) to this endpoint and gets back a short-lived
 * JWT, signed with the portal's Better Auth JWKS key, that says who that
 * credential belongs to. The edge verifies it against /api/auth/jwks and
 * caches it until it expires, so revocation lands at the next refresh.
 */
export const PRINCIPAL_TOKEN_AUDIENCE = "aomi-edge";
export const PRINCIPAL_TOKEN_TTL_SECONDS = 5 * 60;

type PrincipalClaims = {
  sub: string;
  kind: "cookie" | "session_bearer" | "widget";
  guest: boolean;
  origin?: string;
  auth_method?: string;
  expires_at?: number;
  provider_identity_id?: string;
  better_auth_user_id?: string;
};

async function sign(claims: PrincipalClaims, now = Math.floor(Date.now() / 1000)) {
  const exp = now + PRINCIPAL_TOKEN_TTL_SECONDS;
  const { token } = await auth.api.signJWT({
    body: {
      payload: { ...claims, iat: now, exp, aud: PRINCIPAL_TOKEN_AUDIENCE },
    },
  });
  return Response.json(
    { token, expires_at: exp },
    { headers: { "cache-control": "no-store" } },
  );
}

function refused(status: 401 | 403, error: string): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

/** POST: describe the caller's credential as a signed principal token. */
export async function issuePrincipalToken(request: Request): Promise<Response> {
  if (hasWidgetSessionBearer(request)) {
    const widget = await resolveWidgetSession({ request });
    if (!widget) return refused(401, "invalid_widget_session");
    return sign({
      sub: widget.userId,
      kind: "widget",
      guest: widget.authMethod === "anonymous",
      origin: widget.origin,
      auth_method: widget.authMethod,
      expires_at: widget.expiresAt,
      provider_identity_id: widget.providerIdentityId,
    });
  }
  const explicit = request.headers.has("authorization");
  if (!explicit && !request.headers.has("cookie"))
    return new Response(null, { status: 204 });
  const session = await getBetterAuthSession(request);
  const seed = sessionUserSeed(session);
  if (!seed || !session) {
    return explicit ? refused(401, "invalid_token") : new Response(null, { status: 204 });
  }
  const account = await getOrCreateAomiUserForBetterAuthSession(seed);
  return sign({
    sub: account.id,
    kind: explicit ? "session_bearer" : "cookie",
    guest: session.user?.isAnonymous === true,
    better_auth_user_id: seed.betterAuthUserId,
  });
}

/** GET ?client_id=&origin=: may this registered partner widget call from that origin? */
export async function managedOriginAllowed(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id") ?? undefined;
  const origin = url.searchParams.get("origin");
  const allowed = await isManagedWidgetClientOrigin(origin, clientId);
  return Response.json({ allowed }, { headers: { "cache-control": "no-store" } });
}
