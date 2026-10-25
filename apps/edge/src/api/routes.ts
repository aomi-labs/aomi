import type { EdgeEnv } from "../env";
import { config } from "../kernel/config";
import type { CorsPolicy } from "../kernel/cors";
import type { HeaderPolicy } from "../kernel/proxy";
import { target } from "../kernel/proxy";
import { rankOrigins } from "../kernel/pool";

/** The api surface (api.aomi.dev): which upstream a path goes to and under which CORS policy. */
export type RouteName = "api" | "health" | "task" | "task-discovery" | "jwks" | "payment";

export type Route = {
  name: RouteName;
  /** In failover order. */
  targets: URL[];
  headers?: HeaderPolicy;
  /** Hosted-app placement: probe the targets for this app before sending. */
  appId?: string;
  /** Payment routes admit exact methods only. */
  methods?: readonly string[];
};

const API_HEADERS = [
  "Authorization", "Content-Type", "DNT", "User-Agent", "X-Requested-With", "If-Modified-Since",
  "Cache-Control", "Range", "X-Session-Id", "X-Thread-Id", "Aomi-App-Key", "X-Aomi-Handover-Session",
];

export const CORS: Record<RouteName, CorsPolicy> = {
  api: { origin: "allowlist", methods: ["GET", "POST", "PUT", "DELETE"], headers: API_HEADERS, maxAge: 1728000 },
  health: {
    origin: "allowlist",
    methods: ["GET"],
    headers: ["Authorization", "Content-Type", "X-Session-Id", "X-Thread-Id", "Aomi-App-Key"],
    maxAge: 1728000,
  },
  payment: {
    origin: "allowlist",
    methods: ["GET", "HEAD", "POST"],
    headers: ["Authorization", "Content-Type", "Idempotency-Key", "Payment-Signature", "X-Request-Id"],
    expose: ["Payment-Required", "Payment-Response", "X-Request-Id"],
    maxAge: 1728000,
  },
  task: {
    origin: "task",
    methods: ["POST"],
    headers: ["Content-Type", "Payment-Signature"],
    expose: ["Payment-Required", "Payment-Response"],
    maxAge: 1728000,
  },
  // A discovery read may answer with the body-bound 402, so its header is readable by anyone.
  "task-discovery": {
    origin: "any",
    methods: ["GET", "HEAD"],
    headers: ["Content-Type"],
    expose: ["Payment-Required"],
    maxAge: 1728000,
  },
  jwks: { origin: "any", methods: ["GET"], headers: ["Content-Type"], maxAge: 1728000 },
};

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

export const TASK_BUILD_PATH = "/v1/task/build";
const TASK_JOB_PATH =
  /^\/v1\/task\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(status|result)$/i;

/**
 * Task routes are public and wallet-paid: a venue's own Authorization, cookies
 * and router headers are the venue's business, never the API Server's (which
 * answers 401 to any bearer).
 */
const TASK_HEADERS: HeaderPolicy = {
  request: new Set(["accept", "content-type", "content-length", "payment-signature", "user-agent", "x-request-id"]),
};

const TASK_DISCOVERY_PATHS: Record<string, string> = {
  // Domain crawlers get the Task contract, never the API Server's full schema.
  "/openapi.json": "/v1/task/openapi.json",
  "/.well-known/agent.json": "/.well-known/agent.json",
  "/v1/task/openapi.json": "/v1/task/openapi.json",
  "/.well-known/x402": "/.well-known/x402",
};

// The same Payment process serves public account routes and private
// accounting. Only these exact routes (and the signed Stripe webhook) are public.
const PAYMENT_ROUTES: readonly [RegExp, readonly string[]][] = [
  [/^\/v1\/payment\/webhooks\/stripe$/, ["POST"]],
  [/^\/v1\/account\/statement$/, ["GET", "HEAD", "OPTIONS"]],
  [/^\/v1\/(account|builder)\/credits(?:\/(methods|ledger))?$/, ["GET", "HEAD", "OPTIONS"]],
  [/^\/v1\/(account|builder)\/credits\/funding-events$/, ["POST", "OPTIONS"]],
  [/^\/v1\/(account|builder)\/credits\/funding-events\/(current|[0-9a-f-]{36})$/, ["GET", "HEAD", "OPTIONS"]],
  [/^\/v1\/(account|builder)\/credits\/funding-events\/[0-9a-f-]{36}\/cancel$/, ["POST", "OPTIONS"]],
];

export function isTaskPath(pathname: string): boolean {
  return pathname === TASK_BUILD_PATH || TASK_JOB_PATH.test(pathname);
}

function one(name: RouteName, origin: string | null, path: string, search: string, extra: Partial<Route> = {}): Route | null {
  return origin ? { name, targets: [target(origin, path, search)], ...extra } : null;
}

/**
 * The backend pool in rendezvous order for this request's thread. Only hosted-app
 * API traffic is placement-constrained: /health and /metrics are per-host
 * signals, and /api/_internal/* is control-plane traffic about an app that must
 * reach a backend even while the app is loaded nowhere.
 */
function backend(name: RouteName, url: URL, env: EdgeEnv, routingKey: string | null): Route | null {
  const ranked = rankOrigins(routingKey, config(env).pool);
  if (ranked.length === 0) return null;
  const appId = name === "api" && !url.pathname.startsWith("/api/_internal/")
    ? url.searchParams.get("application_id")
    : null;
  return {
    name,
    targets: ranked.map((origin) => target(origin, url.pathname, url.search)),
    ...(appId && /^[1-9]\d*$/.test(appId) ? { appId } : {}),
  };
}

export function resolveRoute(url: URL, env: EdgeEnv, routingKey: string | null = null): Route | null {
  const cfg = config(env);
  const { pathname, search } = url;
  const payment = PAYMENT_ROUTES.find(([path]) => path.test(pathname));
  if (payment) return one("payment", cfg.payment, pathname, search, { methods: payment[1] });
  if (cfg.apiServer) {
    if (TASK_DISCOVERY_PATHS[pathname])
      return one("task-discovery", cfg.apiServer, TASK_DISCOVERY_PATHS[pathname], search);
    if (pathname === "/.well-known/jwks.json") return one("jwks", cfg.apiServer, pathname, search);
    if (isTaskPath(pathname)) return one("task", cfg.apiServer, pathname, search, { headers: TASK_HEADERS });
  }
  if (pathname.startsWith("/api/")) {
    // Manager cutover switch: MANAGER_ORIGIN moves the control-plane routes off
    // the backend pool. The manager is stateless, so one origin is enough.
    if (cfg.manager && isManagerPath(pathname)) return one("api", cfg.manager, pathname, search);
    return backend("api", url, env, routingKey);
  }
  if (pathname === "/health" || pathname === "/metrics") return backend("health", url, env, routingKey);
  return null;
}
