import { createBackendProxy, type AllowedRoute } from "@aomi-labs/account";

/**
 * Landing's same-origin backend proxy. The transport machinery (header
 * filtering, optional bearer minting, SSE, forwarding)
 * lives in `@aomi-labs/account`'s `createBackendProxy`, shared with portal +
 * base. Landing is unauthenticated in this cleanup, so it passes an anonymous
 * resolver and forwards only the widget routes below.
 */
const ALLOWED_ROUTES: AllowedRoute[] = [
  {
    pattern: /^\/api\/account(\/.*)?$/,
    methods: new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]),
  },
  {
    pattern: /^\/api\/thread\/state$/,
    methods: new Set(["GET"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/thread\/chat$/,
    methods: new Set(["POST"]),
    auth: "optional",
  },
  { pattern: /^\/api\/system$/, methods: new Set(["POST"]), auth: "optional" },
  {
    pattern: /^\/api\/thread\/interrupt$/,
    methods: new Set(["POST"]),
    auth: "optional",
  },
  { pattern: /^\/api\/secrets$/, methods: new Set(["GET", "POST", "DELETE"]) },
  { pattern: /^\/api\/secrets\/[^/]+$/, methods: new Set(["DELETE"]) },
  {
    pattern: /^\/api\/thread\/updates$/,
    methods: new Set(["GET"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/threads$/,
    methods: new Set(["GET", "POST"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/threads\/[^/]+$/,
    methods: new Set(["GET", "PATCH", "DELETE"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/sessions$/,
    methods: new Set(["GET", "POST"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/sessions\/[^/]+$/,
    methods: new Set(["GET", "PATCH", "DELETE"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/thread\/events$/,
    methods: new Set(["GET"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/thread\/apps$/,
    methods: new Set(["GET"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/thread\/models$/,
    methods: new Set(["GET"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/thread\/model$/,
    methods: new Set(["POST"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/session\/apps$/,
    methods: new Set(["GET"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/session\/models$/,
    methods: new Set(["GET"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/session\/model$/,
    methods: new Set(["POST"]),
    auth: "optional",
  },
  {
    pattern: /^\/api\/exec\/simulate$/,
    methods: new Set(["POST"]),
    auth: "optional",
  },
];

function rewriteLegacyThreadPath(upstreamUrl: URL): void {
  if (upstreamUrl.pathname === "/api/sessions") {
    upstreamUrl.pathname = "/api/threads";
    return;
  }

  if (upstreamUrl.pathname.startsWith("/api/sessions/")) {
    upstreamUrl.pathname = `/api/threads/${upstreamUrl.pathname.slice(
      "/api/sessions/".length,
    )}`;
    return;
  }

  if (upstreamUrl.pathname === "/api/session/apps") {
    upstreamUrl.pathname = "/api/thread/apps";
    return;
  }

  if (upstreamUrl.pathname === "/api/session/models") {
    upstreamUrl.pathname = "/api/thread/models";
    return;
  }

  if (upstreamUrl.pathname === "/api/session/model") {
    upstreamUrl.pathname = "/api/thread/model";
  }
}

export const { GET, POST, PUT, PATCH, DELETE } = createBackendProxy({
  allowedRoutes: ALLOWED_ROUTES,
  resolveCanonicalUserId: async () => null,
  applyDefaults: rewriteLegacyThreadPath,
  // Local landing has no Rust backend, so the shared proxy's 127.0.0.1:8080
  // default 502s the demo widget. Keep Vercel preview→staging and
  // production→prod. Override anytime with AOMI_PROXY_BACKEND_URL.
  upstreamBaseUrl:
    process.env.AOMI_PROXY_BACKEND_URL ||
    (process.env.VERCEL_ENV ? undefined : "https://api.aomi.dev"),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
