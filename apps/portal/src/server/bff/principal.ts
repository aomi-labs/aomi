import "server-only";
import { getOrCreateAomiUserForBetterAuthSession } from "@aomi-labs/account/account";
import { cookieWriteAllowed } from "@aomi-labs/account/csrf";
import {
  hasWidgetSessionBearer,
  observedWidgetOrigin,
  resolveWidgetSession,
} from "@aomi-labs/account/widget-auth";

import {
  getBetterAuthSession,
  sessionUserSeed,
  type BetterAuthSession,
} from "@/server/account/session";
import { devToolsAllowed, portalOrigins } from "@/server/env";
import { capabilities, type Need } from "./capabilities";

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
  | { kind: "e2e"; accountId: string; guest: false };

export type PrincipalCode =
  | "invalid_token"
  | "invalid_widget_session"
  | "insufficient_scope"
  | "portal_session_required"
  | "csrf_failed"
  | "unauthenticated";

export class PrincipalError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: PrincipalCode,
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
  // OAuth protected resources live at Edge; Portal only accepts sessions.
  if (isOAuthCredential(request))
    throw new PrincipalError(401, "invalid_token");
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
  if (!capabilities(e2e).includes(need.capability)) return null;
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
