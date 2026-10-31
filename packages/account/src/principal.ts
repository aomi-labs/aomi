/**
 * Who is calling, and which credential says so. Runtime-neutral: no database,
 * no framework. The edge resolves a request to one of these and the account
 * policy (`./policy`) decides what it may do.
 */

/** The prefix of an origin-bound widget session bearer. */
export const WIDGET_TOKEN_PREFIX = "aomi_wst_";

/** The Better Auth session behind a cookie or session bearer, as `getSession` returns it. */
export type BetterAuthSession = {
  user?: {
    id: string;
    email?: string | null;
    emailVerified?: boolean;
    name?: string | null;
    image?: string | null;
    isAnonymous?: boolean | null;
  };
  session?: {
    token?: string;
    expiresAt?: Date | string | number | null;
    fresh?: boolean;
  };
};

/** Who is calling, from exactly one credential. */
export type Principal =
  | { kind: "none" }
  | {
      kind: "cookie" | "session_bearer";
      accountId: string;
      guest: boolean;
      betterAuthUserId: string;
      session: BetterAuthSession;
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
  | "portal_session_required"
  | "csrf_failed"
  | "unauthenticated";

/** The token of a single `Bearer <token>` Authorization header. */
export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) return null;
  return token;
}

/** The widget session bearer a request carries, if any. */
export function widgetBearerToken(request: Request): string | null {
  const token = bearerToken(request);
  return token?.startsWith(WIDGET_TOKEN_PREFIX) ? token : null;
}

export function hasWidgetSessionBearer(request: Request): boolean {
  return widgetBearerToken(request) !== null;
}

/** A DPoP or JWT bearer: an OAuth access token, never a session. */
export function isOAuthCredential(request: Request): boolean {
  const [scheme, credential] = (request.headers.get("authorization") ?? "").trim().split(/\s+/, 2);
  return (
    scheme?.toLowerCase() === "dpop" ||
    (scheme?.toLowerCase() === "bearer" && credential?.split(".").length === 3)
  );
}
