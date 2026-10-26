/**
 * The Build surface at the edge: GitHub sign-in, CLI login, builder credits,
 * the anonymous GitHub App install start and the launch, deployments and
 * operate control-plane families (over the `@aomi-labs/internal` manager
 * client). Anything not listed here passes through to the Vercel Build app
 * unchanged: the build sandbox, integrations and the local-only helpers.
 */
import { passThrough as passThroughTo, proxy, target } from "../kernel/proxy";
import { BACKEND_API_HEADERS } from "../portal/headers";
import type { BuildContext } from "./context";
import { BUILDER_CREDITS_PREFIX, credits } from "./credits";
import { DEPLOY_ROUTES } from "./deploy";
import { type BuildRoute, type Handler } from "./endpoint";
import { failureResponse } from "./failures";
import { apiOrigin } from "./manager-client";
import { OPERATE_ROUTES } from "./operate";
import {
  callback,
  claim,
  cliExchange,
  cliLogin,
  cliStatus,
  login,
  signout,
  status,
} from "./github-auth";

export const GITHUB_APP_INSTALL_START_PATH = "/api/integrations/github-app/oauth/start";

/** Build forwards only the GitHub App install start, anonymously. */
async function installStart(request: Request, ctx: BuildContext): Promise<Response> {
  const url = target(
    apiOrigin(request, ctx, GITHUB_APP_INSTALL_START_PATH),
    GITHUB_APP_INSTALL_START_PATH,
    new URL(request.url).search,
  );
  if (!url.searchParams.get("platform")) url.searchParams.set("platform", ctx.config.platforms[0]);
  return proxy(request, url, { fetchImpl: ctx.fetchImpl, headers: BACKEND_API_HEADERS });
}

export const BUILD_ROUTES: readonly BuildRoute[] = [
  { operation: "github.login", method: "GET", path: "/api/bff/auth/github/login", handle: login },
  { operation: "github.callback", method: "GET", path: "/api/bff/auth/github/callback", handle: callback },
  { operation: "github.claim", method: "GET", path: "/api/bff/auth/github/claim", handle: claim },
  { operation: "github.status", method: "GET", path: "/api/bff/auth/github/status", handle: status },
  { operation: "github.signout", method: "POST", path: "/api/bff/auth/github/signout", handle: signout },
  { operation: "cli.login", method: "GET", path: "/api/bff/cli/login", handle: cliLogin },
  { operation: "cli.exchange", method: "POST", path: "/api/bff/cli/exchange", handle: cliExchange },
  { operation: "cli.status", method: "GET", path: "/api/bff/cli/status", handle: cliStatus },
  { operation: "github_app.install_start", method: "GET", path: GITHUB_APP_INSTALL_START_PATH, handle: installStart },
  ...DEPLOY_ROUTES,
  ...OPERATE_ROUTES,
];

function matches(route: BuildRoute, pathname: string): boolean {
  return typeof route.path === "string" ? route.path === pathname : route.path.test(pathname);
}

export function passThrough(request: Request, ctx: BuildContext): Promise<Response> {
  return passThroughTo(request, ctx.upstreamOrigin, ctx.fetchImpl, "build");
}

async function run(operation: string, handle: Handler, request: Request, ctx: BuildContext): Promise<Response> {
  try {
    return await handle(request, ctx);
  } catch (error) {
    return failureResponse(error, request, operation);
  }
}

/** Serve one request on the Build surface. */
export async function handleBuildRequest(request: Request, ctx: BuildContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === BUILDER_CREDITS_PREFIX || url.pathname.startsWith(`${BUILDER_CREDITS_PREFIX}/`))
    return run("builder.credits", credits, request, ctx);
  const routes = BUILD_ROUTES.filter((route) => matches(route, url.pathname));
  if (routes.length) {
    const route = routes.find((candidate) => candidate.method === request.method);
    if (!route)
      return new Response(null, {
        status: 405,
        headers: { allow: routes.map((candidate) => candidate.method).join(", ") },
      });
    return run(route.operation, route.handle, request, ctx);
  }
  return passThrough(request, ctx);
}
