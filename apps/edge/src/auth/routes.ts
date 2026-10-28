/**
 * The account surface on a portal host: Better Auth and the OAuth server under
 * /api/auth, widget sign-in, the account graph under /v1/account, device
 * login, the OAuth discovery documents and /openapi.json. Each row says what
 * the caller needs per method; the edge identifies the caller in-process (the
 * cookie, a session bearer or a widget session), checks that need against the
 * account policy and runs the handler against the request's database pool.
 */
import type { Auth } from "@aomi-labs/account/better-auth";
import type { Capability, Need } from "@aomi-labs/account/policy";
import type { Principal } from "@aomi-labs/account/principal";

import { config } from "../kernel/config";
import { openWidget, preflight, withCors } from "../kernel/cors";
import { proxy, target } from "../kernel/proxy";
import type { PortalContext } from "../portal/context";
import { PUBLIC_DISCOVERY_HEADERS } from "../portal/headers";
import { authorize, resolvePrincipal } from "../portal/principal";
import * as account from "./account/handlers";
import { handleBetterAuth } from "./better-auth";
import * as deviceAuth from "./device/handlers";
import { authError } from "./errors";
import { isOAuthDiscovery, oauthDiscovery } from "./well-known";
import * as widgetAuth from "./widget/handlers";
import { consumeWidgetBudget, WIDGET_BUDGETS, type WidgetBudget } from "./widget/rate-limit";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** What a route handler receives once the caller is identified and authorized. */
export type Call = {
  request: Request;
  principal: Principal;
  params: Record<string, string>;
  auth: Auth;
};

type Handle = (call: Call) => Promise<Response>;

type Row = {
  path: RegExp;
  operation: string;
  /** One handler per method. */
  handle: Partial<Record<Method, Handle>>;
  /** What the caller needs; "public" skips identification (sign-in and grant routes). */
  need: Need | "public" | ((method: string) => Need);
  /** Fixed per-IP budget, checked before anything else. */
  budget?: WidgetBudget;
  /** Embedding sites may call every family except device login. */
  cors?: "none";
  /** The code an unexpected failure reports. */
  fallback?: string;
};

const capability = (name: Capability): Need => ({ capability: name });
const accountRow = (path: RegExp, operation: string, handle: Row["handle"], need: Row["need"] = capability("account")): Row => ({
  path,
  operation,
  handle,
  need,
  fallback: "widget_auth_failed",
});
const widgetSignIn = (path: RegExp, operation: string, handle: Handle, budget: WidgetBudget = WIDGET_BUDGETS.proof): Row => ({
  path,
  operation,
  need: "public",
  budget,
  handle: { POST: handle },
  fallback: "widget_auth_failed",
});
const deviceRow = (path: RegExp, operation: string, handle: Handle, need: Row["need"]): Row => ({
  path,
  operation,
  need,
  handle: { POST: handle },
  cors: "none",
  fallback: "device_auth_failed",
});

export const AUTH_ROUTES: readonly Row[] = [
  accountRow(
    /^\/v1\/account$/,
    "account",
    { GET: account.readAccount, PATCH: account.updateProfile, DELETE: account.deactivateAccount },
    (method) => (method === "GET" ? { capability: "account", anonymous: true } : capability("account")),
  ),
  accountRow(/^\/v1\/account\/identities\/(?<id>[^/]+)$/, "account.identity", {
    PATCH: account.renameIdentity,
    DELETE: account.unlinkIdentity,
  }),
  accountRow(/^\/v1\/account\/connections$/, "account.connections", { GET: account.listConnections }),
  accountRow(
    /^\/v1\/account\/connections\/oauth\/(?<client_id>[^/]+)$/,
    "account.connection",
    { DELETE: account.disconnectOAuthConnection },
    capability("portal_session"),
  ),
  accountRow(
    /^\/v1\/account\/connections\/telegram$/,
    "account.connection.telegram",
    { DELETE: account.disconnectTelegramConnection },
    capability("portal_session"),
  ),
  accountRow(/^\/v1\/account\/wallets\/link$/, "wallet.link", { GET: account.walletLinkNonce, POST: account.linkWallet }),
  accountRow(/^\/v1\/account\/wallets\/(?<id>[^/]+)$/, "account.wallet", {
    PATCH: account.renameAccountWallet,
    DELETE: account.unlinkAccountWallet,
  }),
  accountRow(/^\/v1\/account\/merge$/, "account.merge", { POST: account.mergeAccount }),
  accountRow(/^\/v1\/account\/merge\/switch$/, "account.merge_switch", { POST: account.switchToMergeSource }),
  accountRow(/^\/v1\/account\/provider\/exchange$/, "provider.link", { POST: account.linkProvider }),
  {
    path: /^\/v1\/account\/session\/cli$/,
    operation: "account.cli_session",
    need: capability("cli_session"),
    handle: { POST: account.rotateCliSession },
  },
  deviceRow(/^\/v1\/account\/device-auth\/link-intent$/, "device_auth.link_intent", deviceAuth.startDeviceLink, capability("device_login")),
  deviceRow(/^\/v1\/account\/device-auth\/link-grant$/, "device_auth.link_grant", deviceAuth.grantDeviceLink, "public"),
  deviceRow(/^\/v1\/account\/device-auth\/exchange$/, "device_auth.exchange", deviceAuth.exchangeDeviceGrant, "public"),
  widgetSignIn(/^\/api\/auth\/widget\/guest$/, "widget.guest", widgetAuth.signInGuest, WIDGET_BUDGETS.guest),
  widgetSignIn(/^\/api\/auth\/widget\/exchange$/, "widget.provider.exchange", widgetAuth.exchangeProvider),
  widgetSignIn(/^\/api\/auth\/widget\/siwe\/nonce$/, "widget.siwe.nonce", widgetAuth.siweNonce),
  widgetSignIn(/^\/api\/auth\/widget\/siwe\/verify$/, "widget.siwe.verify", widgetAuth.siweVerify),
  widgetSignIn(/^\/api\/auth\/widget\/siws\/nonce$/, "widget.siws.nonce", widgetAuth.siwsNonce),
  widgetSignIn(/^\/api\/auth\/widget\/siws\/verify$/, "widget.siws.verify", widgetAuth.siwsVerify),
  {
    path: /^\/api\/auth\/widget\/session$/,
    operation: "widget.session.revoke",
    need: "public",
    handle: { DELETE: widgetAuth.revokeSession },
    fallback: "widget_auth_failed",
  },
  {
    path: /^\/api\/auth\/widget\/oauth-bootstrap$/,
    operation: "widget.oauth_bootstrap.issue",
    need: capability("account"),
    budget: WIDGET_BUDGETS.proof,
    handle: { POST: widgetAuth.issueOAuthBootstrap },
    fallback: "widget_auth_failed",
  },
];

/** Identify, authorize, handle, map errors, apply CORS. */
async function serve(row: Row, match: RegExpExecArray, request: Request, ctx: PortalContext): Promise<Response> {
  const methods = Object.keys(row.handle);
  const cors = openWidget(methods);
  const cfg = config(ctx.env);
  if (request.method === "OPTIONS") return row.cors === "none" ? new Response(null, { status: 204 }) : preflight(cors, request, cfg);
  const handle = row.handle[request.method as Method];
  let response: Response;
  try {
    if (!handle) response = new Response(null, { status: 405, headers: { allow: [...methods, "OPTIONS"].join(", ") } });
    else {
      const need = typeof row.need === "function" ? row.need(request.method) : row.need;
      response =
        (row.budget && (await consumeWidgetBudget(request, row.budget))) ||
        (await handle({
          request,
          principal: need === "public" ? { kind: "none" } : await authorized(request, need, ctx),
          params: { ...match.groups },
          // Built on first use: most account routes never touch Better Auth.
          get auth() {
            return ctx.auth();
          },
        }));
    }
  } catch (error) {
    response = authError(error, request, row.operation, row.fallback);
  }
  return row.cors === "none" ? response : withCors(cors, request, response, cfg);
}

async function authorized(request: Request, need: Need, ctx: PortalContext): Promise<Principal> {
  const principal = await resolvePrincipal(request, need, ctx);
  authorize(principal, need, ctx);
  return principal;
}

/** The agent API's OpenAPI document, credential-free. */
async function openapi(request: Request, ctx: PortalContext): Promise<Response> {
  const origin = config(ctx.env).apiServer;
  if (!origin) return Response.json({ error: "not_found" }, { status: 404 });
  const { pathname, search } = new URL(request.url);
  try {
    return await proxy(request, target(origin, pathname, search), { fetchImpl: ctx.fetchImpl, headers: PUBLIC_DISCOVERY_HEADERS });
  } catch (error) {
    return authError(error, request, "discovery");
  }
}

/** Serve the request if it is on the account surface; null when it is not. */
export async function handleAuthRequest(request: Request, ctx: PortalContext): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  for (const row of AUTH_ROUTES) {
    const match = row.path.exec(pathname);
    if (match) return serve(row, match, request, ctx);
  }
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return handleBetterAuth(request, ctx);
  if (isOAuthDiscovery(pathname)) return oauthDiscovery(request, ctx);
  if (pathname === "/openapi.json" && request.method === "GET") return openapi(request, ctx);
  return null;
}
