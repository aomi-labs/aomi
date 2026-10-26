import "server-only";
import { PUBLIC_DISCOVERY_HEADERS, forward } from "@aomi-labs/account/forward";

import * as account from "@/server/account/handlers";
import * as deviceAuth from "@/server/device-auth/handlers";
import type { NextRequest } from "next/server";
import { agentApiUrl, devToolsAllowed } from "@/server/env";
import * as widgetAuth from "@/server/widget-auth/handlers";
import {
  consumeWidgetBudget,
  WIDGET_BUDGETS,
  type WidgetBudget,
} from "@/server/widget-auth/rate-limit";
import { authorize, type Need } from "./capabilities";
import { openWidget } from "./cors";
import { errorResponse } from "./http";
import { resolvePrincipal, type Principal } from "./principal";

type Params = Record<string, string | string[] | undefined>;
type Context = { params?: Promise<Params> };

/** What a route handler receives once the caller is identified and authorized. */
export type Call = {
  request: Request;
  principal: Principal;
  params: Params;
};

type Handle = (call: Call) => Promise<Response>;

type Route = {
  operation: string;
  /** One handler for every method, or one per method. */
  handle: Handle | Partial<Record<Method, Handle>>;
  methods?: readonly Method[];
  /**
   * What the caller needs. "public" skips identification (sign-in and
   * callback routes); null means there is no such route here.
   */
  need: Need | "public" | ((request: Request) => Need | "public" | null);
  /** Fixed per-IP budget, checked before anything else. */
  budget?: WidgetBudget;
  /** Embedding sites may call every family except device login. */
  cors?: "open_widget" | "none";
  /** The code an unexpected failure reports. */
  fallback?: string;
};

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Handler = (request: Request, context?: Context) => Promise<Response>;
type Binding = Record<string, Handler> & {
  OPTIONS: (request: Request) => Response;
};

/** Bind one route family: identify, authorize, handle, map errors, apply CORS. */
function bind(route: Route): Binding {
  const methods = route.methods ?? (Object.keys(route.handle) as Method[]);
  const handler: Handler = async (request, context) => {
    const need =
      typeof route.need === "function" ? route.need(request) : route.need;
    let response: Response;
    try {
      response =
        (route.budget && (await consumeWidgetBudget(request, route.budget))) ||
        (need === null
          ? Response.json({ error: "not_found" }, { status: 404 })
          : await handleAuthorized(route, request, need, context));
    } catch (error) {
      response = errorResponse(error, request, {
        operation: route.operation,
        fallback: route.fallback,
      });
    }
    return route.cors === "none"
      ? response
      : openWidget.apply(request, response);
  };
  return {
    ...Object.fromEntries(methods.map((method) => [method, handler])),
    OPTIONS: (request: Request) => openWidget.preflight(request, methods),
  } as Binding;
}

async function handleAuthorized(
  route: Route,
  request: Request,
  need: Need | "public",
  context: Context | undefined,
): Promise<Response> {
  const params = (await context?.params) ?? {};
  const handle =
    typeof route.handle === "function"
      ? route.handle
      : route.handle[request.method as Method]!;
  if (need === "public")
    return handle({
      request,
      principal: { kind: "none" },
      params,
    });
  const started = performance.now();
  const principal = await resolvePrincipal(request, need);
  authorize(principal, need);
  const authMs = performance.now() - started;
  const response = await handle({ request, principal, params });
  response.headers.append("server-timing", `bff_auth;dur=${authMs.toFixed(1)}`);
  return response;
}

/** Every portal BFF route family. Route files bind one entry each. */
export const routes = {
  account: bind({
    operation: "account",
    need: (request) =>
      request.method === "GET"
        ? { capability: "account", anonymous: true }
        : { capability: "account" },
    handle: {
      GET: account.readAccount,
      PATCH: account.updateProfile,
      DELETE: account.deactivateAccount,
    },
    fallback: "widget_auth_failed",
  }),
  identity: bind({
    operation: "account.identity",
    need: { capability: "account" },
    handle: { PATCH: account.renameIdentity, DELETE: account.unlinkIdentity },
    fallback: "widget_auth_failed",
  }),
  connections: bind({
    operation: "account.connections",
    need: { capability: "account" },
    handle: { GET: account.listConnections },
    fallback: "widget_auth_failed",
  }),
  connection: bind({
    operation: "account.connection",
    need: { capability: "account" },
    handle: { DELETE: account.disconnectOAuthConnection },
    fallback: "widget_auth_failed",
  }),
  telegramConnection: bind({
    operation: "account.connection.telegram",
    need: { capability: "account" },
    handle: { DELETE: account.disconnectTelegramConnection },
    fallback: "widget_auth_failed",
  }),
  wallet: bind({
    operation: "account.wallet",
    need: { capability: "account" },
    handle: {
      PATCH: account.renameAccountWallet,
      DELETE: account.unlinkAccountWallet,
    },
    fallback: "widget_auth_failed",
  }),
  walletLink: bind({
    operation: "wallet.link",
    need: { capability: "account" },
    handle: { GET: account.walletLinkNonce, POST: account.linkWallet },
    fallback: "widget_auth_failed",
  }),
  merge: bind({
    operation: "account.merge",
    need: { capability: "account" },
    handle: { POST: account.mergeAccount },
    fallback: "widget_auth_failed",
  }),
  mergeSwitch: bind({
    operation: "account.merge_switch",
    need: { capability: "account" },
    handle: { POST: account.switchToMergeSource },
    fallback: "widget_auth_failed",
  }),
  providerLink: bind({
    operation: "provider.link",
    need: { capability: "account" },
    handle: { POST: account.linkProvider },
    fallback: "widget_auth_failed",
  }),
  cliSession: bind({
    operation: "account.cli_session",
    need: { capability: "cli_session" },
    handle: { POST: account.rotateCliSession },
  }),

  deviceLinkIntent: bind({
    operation: "device_auth.link_intent",
    need: { capability: "device_login" },
    handle: { POST: deviceAuth.startDeviceLink },
    cors: "none",
    fallback: "device_auth_failed",
  }),
  deviceLinkGrant: bind({
    operation: "device_auth.link_grant",
    need: "public",
    handle: { POST: deviceAuth.grantDeviceLink },
    cors: "none",
    fallback: "device_auth_failed",
  }),
  deviceExchange: bind({
    operation: "device_auth.exchange",
    need: "public",
    handle: { POST: deviceAuth.exchangeDeviceGrant },
    cors: "none",
    fallback: "device_auth_failed",
  }),

  widgetGuest: widgetSignIn(
    "widget.guest",
    widgetAuth.signInGuest,
    WIDGET_BUDGETS.guest,
  ),
  widgetExchange: widgetSignIn(
    "widget.provider.exchange",
    widgetAuth.exchangeProvider,
  ),
  siweNonce: widgetSignIn("widget.siwe.nonce", widgetAuth.siweNonce),
  siweVerify: widgetSignIn("widget.siwe.verify", widgetAuth.siweVerify),
  siwsNonce: widgetSignIn("widget.siws.nonce", widgetAuth.siwsNonce),
  siwsVerify: widgetSignIn("widget.siws.verify", widgetAuth.siwsVerify),
  widgetSession: bind({
    operation: "widget.session.revoke",
    need: "public",
    handle: { DELETE: widgetAuth.revokeSession },
    fallback: "widget_auth_failed",
  }),
  oauthBootstrap: bind({
    operation: "widget.oauth_bootstrap.issue",
    need: { capability: "account" },
    budget: WIDGET_BUDGETS.proof,
    handle: { POST: widgetAuth.issueOAuthBootstrap },
    fallback: "widget_auth_failed",
  }),

  e2eWallet: { GET: devRoute("seedWallet") },
  e2eExecute: { POST: devRoute("executeEvm") },
  e2eSolana: { POST: devRoute("executeSolana") },

  discovery: {
    GET: (request: Request) => {
      const { pathname, search } = new URL(request.url);
      return forward({
        request,
        url: new URL(`${pathname}${search}`, agentApiUrl()),
        policy: PUBLIC_DISCOVERY_HEADERS,
      }).catch((error) =>
        errorResponse(error, request, { operation: "discovery" }),
      );
    },
  },
};

function widgetSignIn(
  operation: string,
  handle: Handle,
  budget: WidgetBudget = WIDGET_BUDGETS.proof,
): Binding {
  return bind({
    operation,
    need: "public",
    budget,
    handle: { POST: handle },
    fallback: "widget_auth_failed",
  });
}

/** A local E2E wallet route; it does not exist wherever dev tools are not allowed. */
function devRoute(name: "seedWallet" | "executeEvm" | "executeSolana") {
  return async (request: NextRequest): Promise<Response> =>
    devToolsAllowed()
      ? (await import("./dev/e2e-routes"))[name](request)
      : new Response(null, { status: 404 });
}
