import type { EdgeEnv } from "../env";
import { rankOrigins, resolvePool } from "./pool";

export type CorsProfile =
  | "api"
  | "health"
  | "task"
  | "task-discovery"
  | "jwks"
  | "payment";

/** Which request headers may reach the upstream; absent means "all". */
export type UpstreamHeaderPolicy = ReadonlySet<string>;

export type Route = {
  targetUrl: URL;
  corsProfile: CorsProfile;
  fallbackUrls: URL[];
  /** Hosted-app placement inputs, present only on constrained /api traffic. */
  appId?: string;
  backendOrigins?: string[];
  /** Header allowlist applied when building the upstream request. */
  upstreamHeaders?: UpstreamHeaderPolicy;
};

function joinPath(basePath: string, suffixPath: string): string {
  const normalizedBase =
    basePath && basePath !== "/" ? basePath.replace(/\/+$/, "") : "";
  const normalizedSuffix = suffixPath.startsWith("/")
    ? suffixPath
    : `/${suffixPath}`;
  return normalizedBase ? `${normalizedBase}${normalizedSuffix}` : normalizedSuffix;
}

export function buildTargetUrl(
  baseUrl: string,
  suffixPath = "",
  search = "",
): URL {
  const target = new URL(baseUrl);
  target.pathname = joinPath(target.pathname, suffixPath || "/");
  target.search = search || "";
  return target;
}

export function buildRoute(
  targetUrl: URL,
  corsProfile: CorsProfile,
  fallbackUrls: URL[] = [],
  options: Partial<Route> = {},
): Route {
  return { targetUrl, corsProfile, fallbackUrls, ...options };
}

function buildBackendRoute(
  url: URL,
  env: EdgeEnv,
  routingKey: string | null,
  corsProfile: CorsProfile,
): Route | null {
  // Only hosted-app API traffic is placement-constrained. /health and /metrics
  // are per-host signals: an `application_id` on those is never a routing
  // input, or a probe would report the wrong host's liveness. /api/_internal/*
  // is service control-plane traffic ABOUT an app (vault reads/writes), not
  // traffic TO the app: it must reach a backend even while the app's artifact
  // is loaded nowhere, so it is never availability-constrained.
  const rawAppId =
    corsProfile === "api" && !url.pathname.startsWith("/api/_internal/")
      ? url.searchParams.get("application_id")
      : null;
  const appId = rawAppId && /^[1-9]\d*$/.test(rawAppId) ? rawAppId : null;
  const ranked = rankOrigins(routingKey, resolvePool(env));
  if (ranked.length === 0) return null;
  const [primary, ...rest] = ranked;
  return buildRoute(
    buildTargetUrl(primary, url.pathname, url.search),
    corsProfile,
    rest.map((origin) => buildTargetUrl(origin, url.pathname, url.search)),
    appId ? { appId, backendOrigins: ranked } : undefined,
  );
}

// Deploy control-plane routes owned by bin/manager. Exact paths, not a
// prefix: the live per-host app reads (GET .../apps, GET .../apps/:app) stay on
// the backend. Keep in sync with the manager router
// (aomi/bin/manager/src/routes.rs) and the backend platform router
// (aomi/bin/backend/src/endpoint/platform/mod.rs) in product-mono.
const MANAGER_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/api\/manager\/openapi\.json$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^/]+\/attempts(?:\/[^/]+(?:\/cancel)?)?$/,
  /^\/api\/integrations\/github-app\/webhook$/,
  /^\/api\/integrations\/github-app\/oauth\/(start|callback|result|exchange|claim)$/,
  /^\/api\/integrations\/github-app\/builder\/applications\/[^/]+(?:\/detail|\/app-key|\/tools\/[^/]+\/trace)?$/,
  /^\/api\/integrations\/github-app\/user\/projects$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^/]+$/,
  /^\/api\/integrations\/github-app\/user\/deployments$/,
  /^\/api\/integrations\/github-app\/user\/(observability|payments|transactions|statement|usage|logs|installations)$/,
  // `/command-secret` is the builder's read of a bot's derived signing key;
  // `/webhook` compares Telegram's registered webhook with the manager's.
  /^\/api\/integrations\/github-app\/user\/bots(?:\/[^/]+(?:\/(?:command-secret|webhook))?)?$/,
  /^\/api\/integrations\/github-app\/user\/model-keys(?:\/[^/]+(?:\/grants)?)?$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^/]+\/(latest-deployment|required-secrets|sdk-upgrade|sdk-upgrade-status|deployments|apps|transactions|usage|logs|observability|statement)$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^/]+\/deployments\/[^/]+(?:\/promote|\/refresh)?$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^/]+\/releases\/activate$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^/]+\/deployments\/import$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^/]+\/bots(\/[^/]+)?$/,
  /^\/api\/integrations\/github-app\/platforms\/[^/]+\/projects\/create-from-template$/,
  /^\/api\/platforms$/,
  /^\/api\/platforms\/server-tags$/,
  /^\/api\/platforms\/[^/]+\/(activate|deactivate)$/,
  /^\/api\/platforms\/[^/]+\/apps\/activate$/,
  /^\/api\/platforms\/[^/]+\/applications\/[^/]+\/deactivate$/,
  /^\/api\/platforms\/[^/]+\/deployments\/[^/]+\/(status|rerun)$/,
  /^\/api\/platforms\/[^/]+\/apps\/[^/]+\/records$/,
  /^\/api\/platforms\/[^/]+\/projects$/,
  /^\/api\/platforms\/[^/]+\/tokens(\/[^/]+)?$/,
  // Admin-only partner venue row; the backend has no such route.
  /^\/api\/platforms\/[^/]+\/venue$/,
  // Handover, plus the wallet channel's own endpoints: `/nonce` and `/bot`
  // are one segment where the others are two, and `/status` joins activate
  // and revoke as a third.
  /^\/api\/platforms\/[^/]+\/telegram\/handover(?:\/(?:nonce|bot)|\/[^/]+\/[^/]+(?:\/(?:activate|revoke|status))?)?$/,
  /^\/api\/projects\/[^/]+\/deploy$/,
  // Account-owned bots. The rest of `/api/account/*` stays on the backend.
  /^\/api\/account\/bots(?:\/[^/]+)?$/,
];

export function isManagerPath(pathname: string): boolean {
  return MANAGER_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

// Manager cutover switch: unset leaves every route on the backend pool; set
// MANAGER_ORIGIN to the manager tunnel hostname to move the control-plane
// routes over. Manager is stateless (DB-backed), so a single origin with no
// rendezvous hashing is enough.
function buildManagerRoute(
  url: URL,
  env: EdgeEnv,
  corsProfile: CorsProfile,
): Route | null {
  const origin = (env.MANAGER_ORIGIN || "").trim();
  if (!origin || !isManagerPath(url.pathname)) return null;
  return buildRoute(buildTargetUrl(origin, url.pathname, url.search), corsProfile);
}

export const TASK_BUILD_PATH = "/v1/task/build";
const TASK_JOB_PATH =
  /^\/v1\/task\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(status|result)$/i;

/**
 * What a public Task request may carry upstream. Task routes are public and
 * wallet-paid: a venue's own `Authorization`, cookies and router headers are
 * the venue's business, never the API Server's (which answers 401 to any
 * bearer). The Worker adds the forwarding headers itself.
 */
export const TASK_UPSTREAM_HEADERS: UpstreamHeaderPolicy = new Set([
  "accept",
  "content-type",
  "content-length",
  "payment-signature",
  "user-agent",
  "x-request-id",
]);

export function isTaskPath(pathname: string): boolean {
  return pathname === TASK_BUILD_PATH || TASK_JOB_PATH.test(pathname);
}

// The API Server owns versioned wallet-native interfaces. Expose only routes
// deliberately admitted here; its other /v1 surfaces remain behind the edge's
// authenticated proxies. API_SERVER_ORIGIN is injected only where a public
// API Server route is enabled.
function buildApiServerRoute(url: URL, env: EdgeEnv): Route | null {
  const origin = (env.API_SERVER_ORIGIN || "").trim();
  if (!origin) return null;
  if (url.pathname === "/openapi.json") {
    // Domain crawlers get the Task contract, never the API Server's full schema.
    return buildRoute(
      buildTargetUrl(origin, "/v1/task/openapi.json", url.search),
      "task-discovery",
    );
  }
  if (
    ["/.well-known/agent.json", "/v1/task/openapi.json", "/.well-known/x402"].includes(
      url.pathname,
    )
  ) {
    return buildRoute(buildTargetUrl(origin, url.pathname, url.search), "task-discovery");
  }
  if (url.pathname === "/.well-known/jwks.json") {
    return buildRoute(buildTargetUrl(origin, url.pathname, url.search), "jwks");
  }
  if (!isTaskPath(url.pathname)) return null;
  return buildRoute(buildTargetUrl(origin, url.pathname, url.search), "task", [], {
    upstreamHeaders: TASK_UPSTREAM_HEADERS,
  });
}

// The same Payment process serves public account routes and private accounting.
// Only the signed Stripe webhook is public under /v1/payment/*.
export function paymentMethods(path: string): string | null {
  if (path === "/v1/payment/webhooks/stripe") return "POST";
  if (path === "/v1/account/statement") return "GET, HEAD, OPTIONS";
  if (/^\/v1\/(account|builder)\/credits(?:\/(methods|ledger))?$/.test(path))
    return "GET, HEAD, OPTIONS";
  if (/^\/v1\/(account|builder)\/credits\/funding-events$/.test(path))
    return "POST, OPTIONS";
  if (
    /^\/v1\/(account|builder)\/credits\/funding-events\/(current|[0-9a-f-]{36})$/.test(
      path,
    )
  )
    return "GET, HEAD, OPTIONS";
  if (
    /^\/v1\/(account|builder)\/credits\/funding-events\/[0-9a-f-]{36}\/cancel$/.test(
      path,
    )
  )
    return "POST, OPTIONS";
  return null;
}

export function resolveRoute(
  url: URL,
  env: EdgeEnv,
  routingKey: string | null = null,
): Route | null {
  if (paymentMethods(url.pathname)) {
    const origin = (env.PAYMENT_ORIGIN || "").trim();
    return origin
      ? buildRoute(buildTargetUrl(origin, url.pathname, url.search), "payment")
      : null;
  }
  const apiServer = buildApiServerRoute(url, env);
  if (apiServer) return apiServer;

  if (url.pathname.startsWith("/api/")) {
    return (
      buildManagerRoute(url, env, "api") ||
      buildBackendRoute(url, env, routingKey, "api")
    );
  }

  if (url.pathname === "/health" || url.pathname === "/metrics") {
    return buildBackendRoute(url, env, routingKey, "health");
  }

  return null;
}
