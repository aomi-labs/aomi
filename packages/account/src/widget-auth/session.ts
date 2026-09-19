import { createHash, randomBytes } from "node:crypto";
import { findAomiUserById } from "../db/queries";
import { observedWidgetOrigin } from "./origin";
import {
  widgetAuthStore,
  WIDGET_SESSION_NAMESPACE,
  type WidgetAuthStore,
} from "./store";

export const WIDGET_SESSION_TTL_SECONDS = 30 * 60;
const WIDGET_TOKEN_PREFIX = "aomi_wst_";

export type AccountSession = {
  token: string;
  tokenType: "Bearer";
  expiresAt: number;
  userId: string;
};

export async function issueWidgetSession(input: {
  userId: string;
  origin: string;
  authMethod: string;
  providerIdentityId?: string;
  now?: Date;
  ttlSeconds?: number;
  store?: WidgetAuthStore;
}): Promise<AccountSession> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + (input.ttlSeconds ?? WIDGET_SESSION_TTL_SECONDS) * 1000,
  );
  const token = `${WIDGET_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  await (input.store ?? widgetAuthStore).write({
    identifier: sessionIdentifier(token),
    expiresAt,
    ticket: {
      kind: "widget_session",
      userId: input.userId,
      origin: input.origin,
      authMethod: input.authMethod,
      providerIdentityId: input.providerIdentityId,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  });
  return {
    token,
    tokenType: "Bearer",
    expiresAt: Math.floor(expiresAt.getTime() / 1000),
    userId: input.userId,
  };
}

export async function resolveWidgetSession(input: {
  request: Request;
  now?: Date;
  store?: WidgetAuthStore;
  isUserActive?: (userId: string) => Promise<boolean>;
}): Promise<{
  userId: string;
  origin: string;
  authMethod: string;
  expiresAt: number;
  providerIdentityId?: string;
} | null> {
  const token = widgetBearerToken(input.request);
  const origin = observedWidgetOrigin(input.request);
  if (!token || !origin) return null;
  const ticket = await (input.store ?? widgetAuthStore).read({
    identifier: sessionIdentifier(token),
    now: input.now ?? new Date(),
  });
  if (ticket?.kind !== "widget_session" || ticket.origin !== origin)
    return null;
  const active = input.isUserActive
    ? await input.isUserActive(ticket.userId)
    : Boolean(await findAomiUserById(ticket.userId));
  if (!active) return null;
  return {
    userId: ticket.userId,
    origin: ticket.origin,
    authMethod: ticket.authMethod,
    expiresAt: Math.floor(new Date(ticket.expiresAt).getTime() / 1000),
    providerIdentityId: ticket.providerIdentityId,
  };
}

export async function revokeWidgetSession(input: {
  request: Request;
  now?: Date;
  store?: WidgetAuthStore;
  // Accepted for call-site symmetry with resolveWidgetSession but intentionally
  // ignored: revocation must succeed even for a deactivated user's token so the
  // row is always cleaned up rather than left dangling.
  isUserActive?: (userId: string) => Promise<boolean>;
}): Promise<boolean> {
  const token = widgetBearerToken(input.request);
  const origin = observedWidgetOrigin(input.request);
  if (!token || !origin) return false;
  const store = input.store ?? widgetAuthStore;
  const identifier = sessionIdentifier(token);
  const ticket = await store.read({
    identifier,
    now: input.now ?? new Date(),
  });
  // Only the token's own origin may revoke it, but the owning user's active
  // state is deliberately not consulted (see the `isUserActive` note above).
  if (ticket?.kind !== "widget_session" || ticket.origin !== origin) {
    return false;
  }
  return store.delete({ identifier });
}

export function hasWidgetSessionBearer(request: Request): boolean {
  return widgetBearerToken(request) !== null;
}

export function widgetSessionIdentifierForRequest(
  request: Request,
): string | null {
  const token = widgetBearerToken(request);
  return token ? sessionIdentifier(token) : null;
}

/** Revalidates the WST row captured by a bootstrap ticket without exposing the
 * bearer token. This closes the window where a revoked WST could otherwise be
 * exchanged after the widget issued an OAuth bootstrap ticket. */
export async function validateWidgetSessionBinding(input: {
  identifier: string;
  origin: string;
  userId: string;
  authMethod: string;
  providerIdentityId?: string;
  now?: Date;
  store?: WidgetAuthStore;
}): Promise<boolean> {
  const ticket = await (input.store ?? widgetAuthStore).read({
    identifier: input.identifier,
    now: input.now ?? new Date(),
  });
  if (
    ticket?.kind !== "widget_session" ||
    ticket.origin !== input.origin ||
    ticket.userId !== input.userId ||
    ticket.authMethod !== input.authMethod ||
    ticket.providerIdentityId !== input.providerIdentityId
  ) {
    return false;
  }
  return Boolean(await findAomiUserById(ticket.userId));
}

function widgetBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) return null;
  return token.startsWith(WIDGET_TOKEN_PREFIX) ? token : null;
}

function sessionIdentifier(token: string): string {
  return `${WIDGET_SESSION_NAMESPACE}${createHash("sha256").update(token).digest("hex")}`;
}
