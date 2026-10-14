import "@tanstack/react-start/server-only";
import { mintAccountBearer, mintAgentApiBearer } from "@aomi-labs/account";
import { aomiOAuthResources } from "@aomi-labs/account/better-auth/core";
import { auth } from "@/server/auth";
import {
  AGENT_API_HEADERS,
  BACKEND_API_HEADERS,
  PUBLIC_DISCOVERY_HEADERS,
  forward,
} from "@aomi-labs/account/forward";
import { requireMcpAuth } from "@better-auth/mcp";

import * as account from "@/server/account/handlers";
import * as deviceAuth from "@/server/device-auth/handlers";
import {
  agentApiUrl,
  appCatalogPlatforms,
  backendUrl,
  devToolsAllowed,
} from "@/server/env";
import * as widgetAuth from "@/server/widget-auth/handlers";
import {
  consumeWidgetBudget,
  WIDGET_BUDGETS,
  type WidgetBudget,
} from "@/server/widget-auth/rate-limit";
import { authorize, policyFor, scopesOn, type Need } from "./capabilities";
import { openWidget, publicRead } from "./cors";
import { errorResponse, mintBearer } from "./http";
import { oauthPrincipal, resolvePrincipal, type Principal } from "./principal";
import { publicCatalog } from "./public-catalog";

type Params = Record<string, string | string[] | undefined>;
type Context = { params?: Promise<Params> };

/** What a route handler receives once the caller is identified and authorized. */
export type Call = {
  request: Request;
  principal: Principal;
  /** Scopes to mint for a protected resource; empty for capability routes. */
  scopes: string[];
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
  /** An OAuth protected resource answers auth failures and 404s in its own shape. */
  resource?: () => string;
  /** Fixed per-IP budget, checked before anything else. */
  budget?: WidgetBudget;
  /** Embedding sites may call every family except device login and MCP. */
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
    const resource =
      route.resource?.() ??
      (need && need !== "public" && "resource" in need
        ? need.resource
        : undefined);
    let response: Response;
    try {
      response =
        (route.budget && (await consumeWidgetBudget(request, route.budget))) ||
        (need === null
          ? notFound(resource)
          : await handleAuthorized(route, request, need, context));
    } catch (error) {
      response = errorResponse(error, request, {
        operation: route.operation,
        resource,
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
      scopes: [],
      params,
    });
  const started = performance.now();
  const principal = await resolvePrincipal(request, need);
  const scopes = authorize(principal, need);
  const authMs = performance.now() - started;
  const response = await handle({ request, principal, scopes, params });
  response.headers.append("server-timing", `bff_auth;dur=${authMs.toFixed(1)}`);
  return response;
}

function notFound(resource: string | undefined): Response {
  return resource
    ? Response.json(
        { error: { code: "not_found", message: "Not found" } },
        { status: 404 },
      )
    : Response.json({ error: "not_found" }, { status: 404 });
}

/** Forward to the Rust backend's /api with an account bearer, or anonymously. */
async function toBackend(call: Call, path: string): Promise<Response> {
  const incoming = new URL(call.request.url);
  const url = new URL(path, backendUrl());
  url.search = incoming.search;
  if (url.pathname === "/api/thread/apps" && !url.searchParams.has("platform"))
    for (const platform of appCatalogPlatforms())
      url.searchParams.append("platform", platform);
  const accountId =
    "accountId" in call.principal ? call.principal.accountId : null;
  const bearer = accountId
    ? (await mintBearer(() => mintAccountBearer(accountId))).bearer
    : undefined;
  return forward({
    request: call.request,
    url,
    policy: BACKEND_API_HEADERS,
    bearer,
  });
}

/** Forward to the agent API with a bearer carrying exactly the authorized scopes. */
async function toAgentApi(call: Call, resource: string): Promise<Response> {
  const { principal } = call;
  if (principal.kind === "none")
    throw new Error("agent API call without a principal");
  const incoming = new URL(call.request.url);
  const { bearer } = await mintBearer(() =>
    mintAgentApiBearer(principal.accountId, {
      scope: call.scopes.join(" "),
      resource,
      client_id: principal.kind === "oauth" ? principal.clientId : undefined,
      auth_source: principal.kind === "oauth" ? "oauth" : "session",
      principal_class: principal.guest ? "guest" : "user",
      grant_id: principal.kind === "oauth" ? principal.grantId : undefined,
      // A raw session token never enters an internal assertion; only the
      // fact that one exists does.
      sid:
        principal.kind !== "oauth" || principal.sessionBound
          ? "session-bound"
          : undefined,
    }),
  );
  return forward({
    request: call.request,
    url: new URL(`${incoming.pathname}${incoming.search}`, agentApiUrl()),
    policy: AGENT_API_HEADERS,
    bearer,
  });
}

const resources = () => aomiOAuthResources();

function withPayment(request: Request, scopes: string[]): string[] {
  return request.headers.has("payment-signature")
    ? [...scopes, "payments:submit"]
    : scopes;
}

function agentApi(
  operation: string,
  methods: readonly Method[],
  resource: () => string,
  scopes: (request: Request) => string[] | null,
): Binding {
  return bind({
    operation,
    methods,
    resource,
    need: (request) => {
      const required = scopes(request);
      return required && { resource: resource(), scopes: required };
    },
    handle: (call) => toAgentApi(call, resource()),
  });
}

/** MCP verifies its own OAuth token (with the MCP challenge) before the shared authorize step. */
function mcp(
  operation: string,
  resource: () => string,
  transport: "mcp:agent" | "mcp:pipeline",
  challengeScopes: string[],
) {
  let post: Handler | undefined;
  return {
    POST: (request: Request) => {
      post ??= requireMcpAuth(
        auth,
        async (request, claims) => {
          const need = {
            resource: resource(),
            scopes: withPayment(request, [transport]),
          };
          try {
            const principal = await oauthPrincipal(claims, need.resource);
            authorize(principal, need);
            // Rust maps each tools/call to its business scope, so the bearer
            // carries every scope of the grant; the portal never reads the body.
            return await toAgentApi(
              {
                request: new Request(request.url, {
                  method: request.method,
                  headers: request.headers,
                  body: await request.arrayBuffer(),
                }),
                principal,
                scopes: [...scopesOn(principal, policyFor(need.resource))],
                params: {},
              },
              need.resource,
            );
          } catch (error) {
            return errorResponse(error, request, {
              operation,
              resource: need.resource,
            });
          }
        },
        {
          resource: resource(),
          requiredScopes: [transport],
          // A client re-authorizes with the challenge scopes, so they must name
          // offline_access or its next grant carries no refresh token.
          challengeScopes,
          dpop: { signingAlgorithms: ["ES256", "EdDSA"] },
        },
      ) as Handler;
      return post(request);
    },
  };
}

/** Account control-plane paths and the scope each method needs. */
const ACCOUNT_CONTROL: readonly {
  path: RegExp;
  scopes: Record<string, string>;
}[] = [
  { path: /^\/v1\/account\/apps$/, scopes: { GET: "account:apps:read" } },
  {
    path: /^\/v1\/account\/apps\/[1-9]\d*$/,
    scopes: { POST: "account:apps:write", DELETE: "account:apps:write" },
  },
  {
    path: /^\/v1\/account\/apps\/[1-9]\d*\/secrets$/,
    scopes: {
      GET: "account:credentials:read",
      POST: "account:credentials:write",
      DELETE: "account:credentials:write",
    },
  },
  {
    path: /^\/v1\/account\/apps\/[1-9]\d*\/secrets\/[A-Za-z_]\w{0,127}$/,
    scopes: { DELETE: "account:credentials:write" },
  },
  {
    path: /^\/v1\/account\/transaction-safety(?:\/threads\/[^/]+)?$/,
    scopes: {
      GET: "account:transaction-safety:read",
      PUT: "account:transaction-safety:write",
    },
  },
];

function accountScope(request: Request): string[] | null {
  const { pathname } = new URL(request.url);
  const scope = ACCOUNT_CONTROL.find(({ path }) => path.test(pathname))?.scopes[
    request.method
  ];
  return scope ? [scope] : null;
}

type BackendRoute = {
  path: RegExp;
  methods: readonly string[];
  need: Need | "public" | ((request: Request) => Need);
};

const commit = (request: Request): Need => ({
  resource: resources().agentRest,
  scopes: [request.method === "GET" ? "agent:read" : "agent:actions:resolve"],
});
const chat: Need = { capability: "chat", anonymous: true };

/** The Rust /api routes the portal forwards. Anything else is a 404. */
export const BACKEND_ROUTES: readonly BackendRoute[] = [
  { path: /^\/api\/commits$/, methods: ["POST"], need: commit },
  { path: /^\/api\/commits\/[0-9a-f-]+$/i, methods: ["GET"], need: commit },
  {
    path: /^\/api\/commits\/[0-9a-f-]+\/manual$/i,
    methods: ["POST"],
    need: commit,
  },
  {
    path: /^\/api\/commits\/[0-9a-f-]+\/wallet-attempts$/i,
    methods: ["POST"],
    need: commit,
  },
  {
    path: /^\/api\/commits\/[0-9a-f-]+\/wallet-attempts\/[0-9a-f-]+\/report$/i,
    methods: ["POST"],
    need: commit,
  },
  {
    path: /^\/api\/thread\/transaction-safety$/,
    methods: ["GET", "PUT"],
    need: { capability: "safety_policy" },
  },
  {
    path: /^\/api\/account(\/.*)?$/,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    need: { capability: "settings" },
  },
  {
    path: /^\/api\/secrets$/,
    methods: ["GET", "POST", "DELETE"],
    need: { capability: "settings" },
  },
  {
    path: /^\/api\/secrets\/[^/]+$/,
    methods: ["DELETE"],
    need: { capability: "settings" },
  },
  {
    path: /^\/api\/integrations\/github-app\/oauth\/start$/,
    methods: ["GET"],
    need: chat,
  },
  { path: /^\/api\/thread\/apps$/, methods: ["GET"], need: chat },
  { path: /^\/api\/thread\/models$/, methods: ["GET"], need: "public" },
  {
    path: /^\/api\/resource\/skills(?:\/[^/]+)?$/,
    methods: ["GET"],
    need: chat,
  },
  { path: /^\/api\/thread\/model$/, methods: ["POST"], need: chat },
  { path: /^\/api\/control\/apps$/, methods: ["GET"], need: chat },
  { path: /^\/api\/control\/models$/, methods: ["GET"], need: chat },
  { path: /^\/api\/control\/model$/, methods: ["POST"], need: chat },
  { path: /^\/api\/exec\/simulate$/, methods: ["POST"], need: chat },
  {
    path: /^\/api\/widget\/v1\/execution-profile$/,
    methods: ["GET"],
    need: { capability: "managed_signing" },
  },
  {
    path: /^\/api\/widget\/v1\/aa-accounts\/[^/]+$/,
    methods: ["PUT"],
    need: { capability: "managed_signing" },
  },
  {
    path: /^\/api\/widget\/v1\/signing-requests\/sign%3A[^/]+$/i,
    methods: ["POST"],
    need: { capability: "managed_signing" },
  },
];

function backendRoute(request: Request): BackendRoute | undefined {
  const { pathname } = new URL(request.url);
  return BACKEND_ROUTES.find(
    (route) =>
      route.path.test(pathname) && route.methods.includes(request.method),
  );
}

const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Every portal BFF route family. Route files bind one entry each. */
export const routes = {
  backend: bind({
    operation: "proxy.request",
    methods: ALL_METHODS,
    need: (request) => {
      const route = backendRoute(request);
      if (!route) return null;
      return typeof route.need === "function"
        ? route.need(request)
        : route.need;
    },
    handle: (call) => toBackend(call, new URL(call.request.url).pathname),
  }),

  agent: agentApi(
    "agent.request",
    ["GET", "POST", "PATCH", "DELETE"],
    () => resources().agentRest,
    (request) => {
      if (request.method === "GET") return ["agent:read"];
      if (/\/actions\/[^/]+\/result$/.test(new URL(request.url).pathname))
        return ["agent:actions:resolve"];
      return withPayment(request, ["agent:write"]);
    },
  ),
  pipeline: agentApi(
    "pipeline.request",
    ["GET", "POST"],
    () => resources().pipelineRest,
    (request) =>
      withPayment(request, [
        request.method === "GET" &&
        !new URL(request.url).pathname.startsWith("/v1/pipeline/evm/commits/")
          ? "pipeline:catalog"
          : "pipeline:execute",
      ]),
  ),
  credits: agentApi(
    "account.credits",
    ["GET"],
    () => resources().accountRest,
    () => ["account:credits:read"],
  ),
  topUp: agentApi(
    "account.top_up",
    ["POST"],
    () => resources().accountRest,
    (request) => withPayment(request, ["account:credits:topup"]),
  ),
  statement: agentApi(
    "account.statement",
    ["GET"],
    () => resources().accountRest,
    () => ["account:usage:read"],
  ),
  accountApps: agentApi(
    "account.apps",
    ["GET", "POST", "DELETE"],
    () => resources().accountRest,
    accountScope,
  ),
  transactionSafety: agentApi(
    "account.transaction_safety",
    ["GET", "PUT"],
    () => resources().accountRest,
    accountScope,
  ),

  agentMcp: mcp("agent.mcp", () => resources().agentMcp, "mcp:agent", [
    "mcp:agent",
    "agent:read",
    "agent:write",
    "offline_access",
  ]),
  pipelineMcp: mcp(
    "pipeline.mcp",
    () => resources().pipelineMcp,
    "mcp:pipeline",
    ["mcp:pipeline", "pipeline:catalog", "offline_access"],
  ),

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
  bearer: bind({
    operation: "account.bearer",
    need: { capability: "backend_bearer" },
    handle: { GET: account.backendBearer },
  }),

  deviceGrant: bind({
    operation: "device_auth.grant",
    need: { capability: "device_login" },
    handle: { POST: deviceAuth.grantDeviceLogin },
    cors: "none",
    fallback: "device_auth_failed",
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
  telegramCustomAuth: widgetSignIn(
    "telegram.custom_auth",
    widgetAuth.telegramCustomAuth,
  ),
  telegramExchange: widgetSignIn(
    "telegram.exchange",
    widgetAuth.exchangeTelegram,
  ),
  telegramCustomAuthKeys: bind({
    operation: "telegram.custom_auth.jwks",
    need: "public",
    handle: { GET: widgetAuth.telegramCustomAuthKeys },
    cors: "none",
  }),
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

  delegationBegin: (provider: "privy" | "para") =>
    bind({
      operation: `delegation.${provider}.begin`,
      need: { capability: "account" },
      handle: {
        POST: (call) => toBackend(call, `/api/auth/${provider}/begin`),
      },
    }),
  delegationCallback: (provider: "privy" | "para") =>
    bind({
      operation: `delegation.${provider}.callback`,
      need: "public",
      handle: { POST: (call) => account.recordDelegation(call, provider) },
      cors: provider === "privy" ? "open_widget" : "none",
    }),

  publicCatalog: {
    GET: async (
      request: Request,
      context: { params: Promise<{ kind: string }> },
    ) =>
      publicRead.apply(
        await publicCatalog(request, (await context.params).kind),
        ["GET"],
      ),
    OPTIONS: () =>
      publicRead.apply(new Response(null, { status: 204 }), ["GET"]),
  },

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
  return async (request: Request): Promise<Response> =>
    devToolsAllowed()
      ? (await import("./dev/e2e-routes"))[name](request)
      : new Response(null, { status: 404 });
}
