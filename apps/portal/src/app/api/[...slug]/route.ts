import { createBackendProxy, type AllowedRoute } from "@aomi-labs/account";
import type { NextRequest } from "next/server";
import { resolveCanonicalUserId } from "@portal/server/canonical-session";
import { launchConfig } from "@portal/server/bff/launch/config";
import { portalFailures } from "@portal/server/bff/failures";
import {
  ApiPrincipalError,
  apiAuthError,
  resolveApiPrincipal,
} from "@portal/server/oauth/principal";
import {
  AGENT_SCOPES,
  aomiOAuthResources,
} from "@portal/server/oauth/resources";
import {
  widgetPreflight,
  widgetRoute,
} from "@portal/server/widget-auth/response";

const COMMIT_ROUTES: AllowedRoute[] = [
  { pattern: /^\/api\/commits$/, methods: new Set(["POST"]) },
  { pattern: /^\/api\/commits\/[0-9a-f-]+$/i, methods: new Set(["GET"]) },
  {
    pattern: /^\/api\/commits\/[0-9a-f-]+\/manual$/i,
    methods: new Set(["POST"]),
  },
  {
    pattern: /^\/api\/commits\/[0-9a-f-]+\/wallet-attempts$/i,
    methods: new Set(["POST"]),
  },
  {
    pattern:
      /^\/api\/commits\/[0-9a-f-]+\/wallet-attempts\/[0-9a-f-]+\/report$/i,
    methods: new Set(["POST"]),
  },
];

const ALLOWED_ROUTES: AllowedRoute[] = [
  ...COMMIT_ROUTES,
  {
    pattern: /^\/api\/thread\/transaction-safety$/,
    methods: new Set(["GET", "PUT"]),
  },
  {
    pattern: /^\/api\/account(\/.*)?$/,
    methods: new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]),
  },
  {
    pattern: /^\/api\/integrations\/github-app\/oauth\/start$/,
    methods: new Set(["GET"]),
    auth: "optional",
  },
  { pattern: /^\/api\/secrets$/, methods: new Set(["GET", "POST", "DELETE"]) },
  { pattern: /^\/api\/secrets\/[^/]+$/, methods: new Set(["DELETE"]) },
  {
    pattern: /^\/api\/thread\/apps$/,
    methods: new Set(["GET"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/thread\/models$/,
    methods: new Set(["GET"]),
    auth: "none",
  },
  {
    pattern: /^\/api\/resource\/skills(?:\/[^/]+)?$/,
    methods: new Set(["GET"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/thread\/model$/,
    methods: new Set(["POST"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/control\/apps$/,
    methods: new Set(["GET"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/control\/models$/,
    methods: new Set(["GET"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/control\/model$/,
    methods: new Set(["POST"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/exec\/simulate$/,
    methods: new Set(["POST"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/widget\/v1\/execution-profile$/,
    methods: new Set(["GET"]),
  },
  {
    pattern: /^\/api\/widget\/v1\/aa-accounts\/[^/]+$/,
    methods: new Set(["PUT"]),
  },
  {
    pattern: /^\/api\/widget\/v1\/signing-requests\/sign%3A[^/]+$/i,
    methods: new Set(["POST"]),
  },
];

// A commit's public OAuth grant authorizes the request, while the Rust API
// still receives only a server-minted AccountBearer for that canonical user.
// The proxy's other /api routes keep their existing session-only resolver.
const commitPrincipalIds = new WeakMap<NextRequest, string>();

const proxy = createBackendProxy({
  allowedRoutes: ALLOWED_ROUTES,
  resolveCanonicalUserId: (request) =>
    Promise.resolve(
      commitPrincipalIds.get(request) ?? resolveCanonicalUserId(request),
    ),
  observeFailure: (failure) => {
    portalFailures.handle({ source: "proxy", failure });
  },
  applyDefaults: (upstreamUrl) => {
    if (
      upstreamUrl.pathname !== "/api/thread/apps" ||
      upstreamUrl.searchParams.has("platform")
    ) {
      return;
    }
    for (const platform of launchConfig().catalogPlatforms) {
      upstreamUrl.searchParams.append("platform", platform);
    }
  },
});

function withCommitPrincipal(handler: typeof proxy.GET) {
  return async (
    request: NextRequest,
    context: Parameters<typeof proxy.GET>[1],
  ): Promise<Response> => {
    const pathname = request.nextUrl.pathname;
    const isCommitRoute = COMMIT_ROUTES.some(
      (route) =>
        route.pattern.test(pathname) && route.methods.has(request.method),
    );
    // Cookie sessions retain their normal proxy path. An explicit credential
    // must be validated here, including opaque session bearers and WSTs, so an
    // invalid OAuth grant cannot silently fall back to an ambient cookie.
    if (!isCommitRoute || !request.headers.has("authorization")) {
      return handler(request, context);
    }

    const resource = aomiOAuthResources().agentRest;
    try {
      const principal = await resolveApiPrincipal({
        request,
        resource,
        requiredScopes: [
          request.method === "GET" ? "agent:read" : "agent:actions:resolve",
        ],
        sessionScopes: AGENT_SCOPES.filter((scope) => scope !== "mcp:agent"),
      });
      commitPrincipalIds.set(request, principal.canonicalUserId);
    } catch (error) {
      if (error instanceof ApiPrincipalError) {
        return apiAuthError(error, resource);
      }
      throw error;
    }

    try {
      return await handler(request, context);
    } finally {
      commitPrincipalIds.delete(request);
    }
  };
}

export const GET = widgetRoute(withCommitPrincipal(proxy.GET), "proxy.request");
export const POST = widgetRoute(
  withCommitPrincipal(proxy.POST),
  "proxy.request",
);
export const PUT = widgetRoute(proxy.PUT, "proxy.request");
export const PATCH = widgetRoute(proxy.PATCH, "proxy.request");
export const DELETE = widgetRoute(proxy.DELETE, "proxy.request");

export const OPTIONS = widgetPreflight([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
