import { withDatabase } from "@aomi-labs/account";

import { handleApiRequest } from "./api/surface";
import { buildContext, isBuildHost } from "./build/context";
import { handleBuildRequest } from "./build/routes";
import type { EdgeEnv } from "./env";
import { withSecurityHeaders } from "./kernel/cors";
import { config } from "./kernel/config";
import { EdgeError, errorResponse } from "./kernel/errors";
import { wait, type FetchLike, type WaitLike } from "./kernel/proxy";
import { handleLandingRequest, isLandingHost } from "./landing";
import { portalContext } from "./portal/context";
import { handlePortalRequest } from "./portal/routes";

export type { EdgeEnv } from "./env";

/**
 * One Worker, four surfaces chosen by host: an app origin's API paths (the
 * portal, Build or Landing) or the public api host. Each surface owns its outside shape
 * and speaks the one inside shape the Rust services expect.
 */
export async function handleRequest(
  request: Request,
  env: EdgeEnv,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  waitImpl: WaitLike = wait,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const redirect = config(env).portal.redirects.get(requestUrl.host.toLowerCase());
  if (redirect)
    return withSecurityHeaders(new Response(null, {
      status: 308,
      headers: {
        "cache-control": "no-store",
        location: `${redirect}${requestUrl.pathname}${requestUrl.search}`,
      },
    }));
  const portal = portalContext(request, env, fetchImpl, waitImpl);
  // The account surface opens a pool over Hyperdrive on first use; it closes after the request.
  const database = env.HYPERDRIVE?.connectionString;
  if (portal && database)
    return withSecurityHeaders(await withDatabase(database, () => handlePortalRequest(request, portal), waitUntil));
  const build = portal ? null : buildContext(request, env, fetchImpl);
  // Build reads builder API keys from the same database, opened only when a request needs it.
  if (build && database)
    return withSecurityHeaders(await withDatabase(database, () => handleBuildRequest(request, build), waitUntil));
  // A Build host without its upstream fails closed instead of falling to the public API.
  if (!portal && !build && isBuildHost(env, new URL(request.url).host)) {
    const error = new EdgeError(503, "build_unconfigured");
    return withSecurityHeaders(errorResponse(error, { surface: "build", operation: "context", request }));
  }
  const response = portal
    ? await handlePortalRequest(request, portal)
    : build
      ? await handleBuildRequest(request, build)
      : isLandingHost(env, new URL(request.url).host)
        ? await handleLandingRequest(request, env, fetchImpl)
        : await handleApiRequest(request, env, fetchImpl, waitImpl);
  return withSecurityHeaders(response);
}
