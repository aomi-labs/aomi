/**
 * Which backend /api paths belong to the manager (bin/manager), and where a
 * backend /api request goes. Every surface that reaches the backend API (the
 * api host, the portal, Build's manager client) resolves its origin here, so
 * the MANAGER_ORIGIN cutover switch moves all of them at once.
 */
import type { EdgeEnv } from "../env";
import { config } from "./config";
import { rankedPool } from "./pool";

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
  /^\/api\/projects\/[^/]+\/deploy$/,
  // Account-owned bots. The rest of `/api/account/*` stays on the backend.
  /^\/api\/account\/bots(?:\/[^/]+)?$/,
];

export function isManagerPath(pathname: string): boolean {
  return MANAGER_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

/**
 * The origins a backend /api request goes to, best first: the manager alone for
 * its control-plane routes once MANAGER_ORIGIN is set (it is stateless, so one
 * origin is enough), else the ranked backend pool.
 */
export function apiOrigins(request: Request, env: EdgeEnv, pathname = new URL(request.url).pathname): string[] {
  const { manager } = config(env);
  return manager && isManagerPath(pathname) ? [manager] : rankedPool(request, env);
}
