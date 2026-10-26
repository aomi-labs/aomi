import type { EdgeEnv } from "../env";
import { config } from "../kernel/config";
import type { CorsPolicy } from "../kernel/cors";
import type { HeaderPolicy } from "../kernel/proxy";
import { target } from "../kernel/proxy";
import { isManagerPath } from "../kernel/manager";
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
  /** A Task discovery document the edge serves itself; `targets` is the API Server. */
  document?: TaskDocument;
};

const API_HEADERS = [
  "Authorization", "Content-Type", "DNT", "User-Agent", "X-Requested-With", "If-Modified-Since",
  "Cache-Control", "Range", "X-Session-Id", "X-Thread-Id", "Aomi-App-Key",
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

export const TASK_BUILD_PATH = "/v1/task/build";

export type TaskDocument = "agent" | "x402" | "openapi";

/** Public discovery paths and the document the edge serves at each. */
const TASK_DOCUMENTS: Readonly<Record<string, TaskDocument>> = {
  "/.well-known/agent.json": "agent",
  "/.well-known/x402": "x402",
  // Domain crawlers get the Task contract, never the API Server's full schema.
  "/openapi.json": "openapi",
  "/v1/task/openapi.json": "openapi",
};
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
    if (Object.hasOwn(TASK_DOCUMENTS, pathname))
      return one("task-discovery", cfg.apiServer, "/", "", { document: TASK_DOCUMENTS[pathname], methods: ["GET", "HEAD"] });
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
