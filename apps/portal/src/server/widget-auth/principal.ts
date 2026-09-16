import {
  hasWidgetSessionBearer,
  observedWidgetOrigin,
  resolveWidgetSession,
} from "@aomi-labs/account/widget-auth";
import {
  getAccountResponseForBetterAuthSession,
  getAccountResponseForWidgetSession,
} from "@aomi-labs/account/account";
import {
  getBetterAuthSession,
  requireAomiSession,
  sessionUserSeed,
} from "@portal/server/account/session";

export type PortalPrincipal =
  | {
      kind: "better_auth";
      userId: string;
      betterAuthUserId: string;
      session: Awaited<ReturnType<typeof getBetterAuthSession>>;
    }
  | {
      kind: "widget";
      userId: string;
      origin: string;
      authMethod: string;
      expiresAt: number;
      providerIdentityId?: string;
    }
  | { kind: "anonymous" };

export class PortalPrincipalError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "PortalPrincipalError";
  }
}

export async function resolvePortalPrincipal(
  request: Request,
): Promise<PortalPrincipal> {
  const firstParty = isFirstPartyRequest(request);
  if (firstParty) {
    const current = await requireAomiSession(request);
    const betterAuthUserId = current?.session?.user?.id;
    if (current && betterAuthUserId) {
      return {
        kind: "better_auth",
        userId: current.user.id,
        betterAuthUserId,
        session: current.session,
      };
    }
  }

  const widget = await resolveWidgetSession({ request });
  if (widget) return { kind: "widget", ...widget };
  if (hasWidgetSessionBearer(request)) {
    throw new PortalPrincipalError("invalid_widget_session", 401);
  }
  return { kind: "anonymous" };
}

export async function requirePortalPrincipal(
  request: Request,
): Promise<Exclude<PortalPrincipal, { kind: "anonymous" }>> {
  const principal = await resolvePortalPrincipal(request);
  if (principal.kind === "anonymous") {
    throw new PortalPrincipalError("unauthenticated", 401);
  }
  return principal;
}

/**
 * Keep bearer-independent Thread reads available to same-origin Portal calls,
 * while requiring an origin-bound widget session for every cross-origin call.
 * This is intentionally separate from AccountBearer minting: a WST proves the
 * embedding origin/session, while the Rust `Thread` auth class consumes the
 * opaque thread capability.
 */
export async function requireCrossOriginWidgetSession(
  request: Request,
): Promise<void> {
  if (isFirstPartyRequest(request)) return;
  const principal = await requirePortalPrincipal(request);
  if (principal.kind !== "widget") {
    throw new PortalPrincipalError("invalid_widget_session", 401);
  }
}

export async function resolvePortalCanonicalUserId(
  request: Request,
): Promise<string | null> {
  const principal = await resolvePortalPrincipal(request);
  return principal.kind === "anonymous" ? null : principal.userId;
}

export async function accountResponseForPrincipal(
  request: Request,
  principal?: Exclude<PortalPrincipal, { kind: "anonymous" }>,
) {
  const resolved = principal ?? (await requirePortalPrincipal(request));
  if (resolved.kind === "widget") {
    return getAccountResponseForWidgetSession({
      userId: resolved.userId,
      expiresAt: resolved.expiresAt,
      authMethod: resolved.authMethod,
    });
  }
  const seed = sessionUserSeed(resolved.session);
  if (!seed) throw new PortalPrincipalError("unauthenticated", 401);
  return getAccountResponseForBetterAuthSession({
    ...seed,
    expiresAt: resolved.session?.session?.expiresAt,
    fresh: resolved.session?.session?.fresh,
  });
}

function isFirstPartyRequest(request: Request): boolean {
  const origin = observedWidgetOrigin(request);
  // No cross-origin `Origin` header => same-origin navigation/POST => first party.
  if (!origin) return true;
  return firstPartyOrigins(request).has(origin);
}

/**
 * The set of origins that count as "first party" for this request.
 *
 * `new URL(request.url).origin` is correct on Vercel, but behind proxies/CDNs
 * that terminate TLS and forward `http://` (reconstructing the request URL on
 * the internal hop), it would report the wrong scheme/host and misclassify a
 * genuine first-party cookie POST as the widget (cross-origin) path. To harden
 * that we also honor the proxy's `x-forwarded-proto`/`x-forwarded-host` and a
 * configured canonical portal origin, when present. All of these only *add*
 * accepted first-party origins; the request's own reconstructed origin is
 * always included, so same-origin behavior is preserved. This cannot be abused
 * to escalate: being treated as first party only switches to cookie-session
 * auth, which still fails closed without a valid Better Auth session cookie.
 */
function firstPartyOrigins(request: Request): Set<string> {
  const origins = new Set<string>([new URL(request.url).origin]);
  const configured = canonicalPortalOrigin();
  if (configured) origins.add(configured);
  const forwarded = forwardedOrigin(request);
  if (forwarded) origins.add(forwarded);
  return origins;
}

function canonicalPortalOrigin(): string | null {
  return (
    normalizeOrigin(process.env.AOMI_PORTAL_BASE_URL) ??
    normalizeOrigin(process.env.BETTER_AUTH_URL)
  );
}

function forwardedOrigin(request: Request): string | null {
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (!host) return null;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    new URL(request.url).protocol.replace(/:$/, "");
  return normalizeOrigin(`${proto}://${host}`);
}

function normalizeOrigin(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}
