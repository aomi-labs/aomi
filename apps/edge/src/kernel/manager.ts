/**
 * Which backend /api paths belong to the manager (bin/manager), and where a
 * backend /api request goes. Every surface that reaches the backend API (the
 * api host, the portal, Build's manager client) resolves its origin here, so
 * the MANAGER_ORIGIN cutover switch moves all of them at once.
 */
import type { EdgeEnv } from "../env";
import { config } from "./config";
import { rankedPool } from "./pool";

// Manager-owned paths follow its published route contract.
const MANAGER_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/api\/manager\/openapi\.json$/,
  /^\/api\/integrations\/github-app\/oauth\/start$/,
  /^\/api\/integrations\/github-app\/oauth\/callback$/,
  /^\/api\/integrations\/github-app\/oauth\/result$/,
  /^\/api\/platforms$/,
  /^\/api\/integrations\/github-app\/webhook$/,
  /^\/api\/integrations\/github-app\/oauth\/exchange$/,
  /^\/api\/integrations\/github-app\/oauth\/claim$/,
  /^\/api\/integrations\/github-app\/user\/projects$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^\/]+$/,
  /^\/api\/integrations\/github-app\/user\/installations$/,
  /^\/api\/integrations\/github-app\/builder\/agents\/[^\/]+$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^\/]+\/agents$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^\/]+\/transactions$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^\/]+\/usage$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^\/]+\/logs$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^\/]+\/observability$/,
  /^\/api\/integrations\/github-app\/user\/observability$/,
  /^\/api\/integrations\/github-app\/user\/payments$/,
  /^\/api\/integrations\/github-app\/user\/transactions$/,
  /^\/api\/integrations\/github-app\/user\/statement$/,
  /^\/api\/integrations\/github-app\/user\/usage$/,
  /^\/api\/integrations\/github-app\/user\/logs$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^\/]+\/statement$/,
  /^\/api\/integrations\/github-app\/builder\/agents\/[^\/]+\/agent-key$/,
  /^\/api\/integrations\/github-app\/builder\/agents\/[^\/]+\/detail$/,
  /^\/api\/integrations\/github-app\/builder\/agents\/[^\/]+\/tools\/[^\/]+\/trace$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^\/]+\/channels$/,
  /^\/api\/integrations\/github-app\/user\/projects\/[^\/]+\/channels\/[^\/]+$/,
  /^\/api\/integrations\/github-app\/user\/channels$/,
  /^\/api\/integrations\/github-app\/user\/channels\/[^\/]+$/,
  /^\/api\/integrations\/github-app\/user\/channels\/[^\/]+\/command-secret$/,
  /^\/api\/integrations\/github-app\/user\/channels\/[^\/]+\/webhook$/,
  /^\/api\/integrations\/github-app\/user\/model-keys$/,
  /^\/api\/integrations\/github-app\/user\/model-keys\/[^\/]+$/,
  /^\/api\/integrations\/github-app\/user\/model-keys\/[^\/]+\/grants$/,
  /^\/api\/publishers\/me$/,
  /^\/api\/publisher\/packages\/[^/]+\/icon$/,
  /^\/api\/packages\/[^\/]+$/,
  /^\/api\/packages\/[^\/]+\/releases$/,
  /^\/api\/packages\/[^\/]+\/promote$/,
  /^\/api\/packages\/[^\/]+\/secrets\/[^\/]+$/,
  /^\/api\/packages\/[^\/]+\/codes$/,
  /^\/api\/packages\/[^\/]+\/codes\/[^\/]+$/,
  /^\/api\/packages\/[^\/]+\/grants\/[^\/]+$/,
  /^\/api\/agents\/[^\/]+$/,
  /^\/api\/agents\/[^\/]+\/configs$/,
  /^\/api\/agents\/[^\/]+\/promote$/,
  /^\/api\/agents\/[^\/]+\/tokens\/[^\/]+$/,
  /^\/api\/account\/channels$/,
  /^\/api\/account\/channels\/[^\/]+$/,
  /^\/api\/platforms\/[^\/]+\/activate$/,
  /^\/api\/platforms\/[^\/]+\/deactivate$/,
  /^\/api\/platforms\/[^\/]+\/projects$/,
];

export function isManagerPath(pathname: string): boolean {
  if (pathname === "/api/agents/resolve") return false;
  return MANAGER_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

/**
 * The origins a backend /api request goes to, best first: the manager alone for
 * its control-plane routes once MANAGER_ORIGIN is set (it is stateless, so one
 * origin is enough), else the ranked backend pool.
 */
export function apiOrigins(
  request: Request,
  env: EdgeEnv,
  pathname = new URL(request.url).pathname,
): string[] {
  const { manager } = config(env);
  return manager && isManagerPath(pathname)
    ? [manager]
    : rankedPool(request, env);
}
