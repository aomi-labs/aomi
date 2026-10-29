/**
 * The account surface on a portal host: Better Auth and the OAuth server under
 * /api/auth, widget sign-in, the account graph under /v1/account, device
 * login, the OAuth discovery documents and /openapi.json. Each row says what
 * the caller needs per method; the edge identifies the caller in-process (the
 * cookie, a session bearer or a widget session), checks that need against the
 * account policy and runs the handler against the request's database pool.
 */
import type { Auth } from "@aomi-labs/account/better-auth";
import { ROUTES, type Method, type Need, type Route } from "@aomi-labs/account/policy";
import type { Principal } from "@aomi-labs/account/principal";

import { config } from "../kernel/config";
import { EdgeError } from "../kernel/errors";
import { openWidget, preflight, withCors } from "../kernel/cors";
import { proxy, target } from "../kernel/proxy";
import type { PortalContext } from "../portal/context";
import { PUBLIC_DISCOVERY_HEADERS } from "../portal/headers";
import { authorize, needOf, resolvePrincipal } from "../portal/principal";
import * as account from "./account/handlers";
import { handleBetterAuth } from "./better-auth";
import * as deviceAuth from "./device/handlers";
import { authError } from "./errors";
import { isOAuthDiscovery, oauthDiscovery } from "./well-known";
import * as widgetAuth from "./widget/handlers";
import { consumeWidgetBudget, WIDGET_BUDGETS, type WidgetBudget } from "./widget/rate-limit";

/** What a route handler receives once the caller is identified and authorized. */
export type Call = {
  request: Request;
  principal: Principal;
  params: Record<string, string>;
  auth: Auth;
};

type Handle = (call: Call) => Promise<Response>;

/** How the edge serves one account route of `ROUTES` (by its operation). */
type Handler = {
  handle: Partial<Record<Method, Handle>>;
  /** Fixed per-IP budget, checked before anything else. */
  budget?: WidgetBudget;
  /** Embedding sites may call every family except device login. */
  cors?: "none";
  /** The code an unexpected failure reports. */
  fallback?: string;
};

const accountRoute = (handle: Handler["handle"]): Handler => ({ handle, fallback: "widget_auth_failed" });
const signIn = (handle: Handle, budget: WidgetBudget = WIDGET_BUDGETS.proof): Handler => ({
  handle: { POST: handle },
  budget,
  fallback: "widget_auth_failed",
});
const device = (handle: Handle): Handler => ({ handle: { POST: handle }, cors: "none", fallback: "device_auth_failed" });

export const HANDLERS: Record<string, Handler> = {
  account: accountRoute({ GET: account.readAccount, PATCH: account.updateProfile, DELETE: account.deactivateAccount }),
  "account.identity": accountRoute({ PATCH: account.renameIdentity, DELETE: account.unlinkIdentity }),
  "account.connections": accountRoute({ GET: account.listConnections }),
  "account.connection": accountRoute({ DELETE: account.disconnectOAuthConnection }),
  "account.connection.telegram": accountRoute({ DELETE: account.disconnectTelegramConnection }),
  "wallet.link": accountRoute({ GET: account.walletLinkNonce, POST: account.linkWallet }),
  "account.wallet": accountRoute({ PATCH: account.renameAccountWallet, DELETE: account.unlinkAccountWallet }),
  "account.merge": accountRoute({ POST: account.mergeAccount }),
  "account.merge_switch": accountRoute({ POST: account.switchToMergeSource }),
  "provider.link": accountRoute({ POST: account.linkProvider }),
  "account.cli_session": { handle: { POST: account.rotateCliSession } },
  "device_auth.link_intent": device(deviceAuth.startDeviceLink),
  "device_auth.link_grant": device(deviceAuth.grantDeviceLink),
  "device_auth.exchange": device(deviceAuth.exchangeDeviceGrant),
  guest: signIn(widgetAuth.signInGuest, WIDGET_BUDGETS.guest),
  "widget.provider.exchange": signIn(widgetAuth.exchangeProvider),
  "widget.siwe.nonce": signIn(widgetAuth.siweNonce),
  "widget.siwe.verify": signIn(widgetAuth.siweVerify),
  "widget.siws.nonce": signIn(widgetAuth.siwsNonce),
  "widget.siws.verify": signIn(widgetAuth.siwsVerify),
  "widget.session.revoke": accountRoute({ DELETE: widgetAuth.revokeSession }),
  "widget.oauth_bootstrap.issue": { ...signIn(widgetAuth.issueOAuthBootstrap), budget: WIDGET_BUDGETS.proof },
};

/** Identify, authorize, handle, map errors, apply CORS. */
async function serve(row: Route, match: RegExpExecArray, request: Request, ctx: PortalContext): Promise<Response> {
  const handler = HANDLERS[row.operation]!;
  const methods = Object.keys(row.methods);
  const cors = openWidget(methods);
  const cfg = config(ctx.env);
  if (request.method === "OPTIONS") return handler.cors === "none" ? new Response(null, { status: 204 }) : preflight(cors, request, cfg);
  const handle = handler.handle[request.method as Method];
  const requirement = row.methods[request.method as Method];
  let response: Response;
  try {
    if (!handle || !requirement)
      response = new Response(null, { status: 405, headers: { allow: [...methods, "OPTIONS"].join(", ") } });
    else {
      const need = needOf(row, requirement, request, undefined);
      response =
        (handler.budget && (await consumeWidgetBudget(request, handler.budget))) ||
        (await handle({
          request,
          principal: need === "public" ? { kind: "none" } : await authorized(request, need, ctx),
          params: decodeParams(match.groups),
          // Built on first use: most account routes never touch Better Auth.
          get auth() {
            return ctx.auth();
          },
        }));
    }
  } catch (error) {
    response = authError(error, request, row.operation, handler.fallback);
  }
  return handler.cors === "none" ? response : withCors(cors, request, response, cfg);
}

/** Path captures arrive percent-encoded (OAuth client ids are URLs); bad encoding is the caller's mistake. */
function decodeParams(groups: Record<string, string> | undefined): Record<string, string> {
  try {
    return Object.fromEntries(Object.entries(groups ?? {}).map(([key, value]) => [key, decodeURIComponent(value)]));
  } catch {
    throw new EdgeError(400, "invalid_request");
  }
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
  for (const row of ROUTES) {
    const match = row.to === "account" ? row.path.exec(pathname) : null;
    if (match) return serve(row, match, request, ctx);
  }
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return handleBetterAuth(request, ctx);
  if (isOAuthDiscovery(pathname)) return oauthDiscovery(request, ctx);
  if (pathname === "/openapi.json" && request.method === "GET") return openapi(request, ctx);
  return null;
}
