import { createBackendProxy, type AllowedRoute } from "@aomi-labs/account";
import { resolveCanonicalUserId } from "@portal/server/canonical-session";
import { launchConfig } from "@portal/server/bff/launch/config";
import { portalFailures } from "@portal/server/bff/failures";
import {
  widgetPreflight,
  widgetRoute,
} from "@portal/server/widget-auth/response";

const ALLOWED_ROUTES: AllowedRoute[] = [
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
    pattern: /^\/api\/widget\/v1\/aa-operations\/[^/]+$/,
    methods: new Set(["GET"]),
  },
  {
    pattern: /^\/api\/widget\/v1\/signing-requests$/,
    methods: new Set(["GET"]),
  },
  {
    pattern: /^\/api\/widget\/v1\/signing-requests\/sign%3A[^/]+$/i,
    methods: new Set(["POST"]),
  },
];

const proxy = createBackendProxy({
  allowedRoutes: ALLOWED_ROUTES,
  resolveCanonicalUserId,
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

export const GET = widgetRoute(proxy.GET, "proxy.request");
export const POST = widgetRoute(proxy.POST, "proxy.request");
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
