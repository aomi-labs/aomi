import { handleApiRequest, wait, type WaitLike } from "./api/surface";
import { buildContext, isBuildHost } from "./build/context";
import { handleBuildRequest } from "./build/routes";
import type { EdgeEnv } from "./env";
import { withSecurityHeaders } from "./kernel/cors";
import { EdgeError, errorResponse } from "./kernel/errors";
import type { FetchLike } from "./kernel/proxy";
import { portalContext } from "./portal/context";
import { handlePortalRequest } from "./portal/routes";

export type { EdgeEnv } from "./env";

/**
 * One Worker, three surfaces chosen by host: an app origin's API paths (the
 * portal or Build) or the public api host. Each surface owns its outside shape
 * and speaks the one inside shape the Rust services expect.
 */
export async function handleRequest(
  request: Request,
  env: EdgeEnv,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  waitImpl: WaitLike = wait,
): Promise<Response> {
  const portal = portalContext(request, env, fetchImpl);
  const build = portal ? null : buildContext(request, env, fetchImpl);
  // A Build host without its upstream fails closed instead of falling to the public API.
  if (!portal && !build && isBuildHost(env, new URL(request.url).host)) {
    const error = new EdgeError(503, "build_unconfigured");
    return withSecurityHeaders(errorResponse(error, { surface: "build", operation: "context", request }));
  }
  const response = portal
    ? await handlePortalRequest(request, portal)
    : build
      ? await handleBuildRequest(request, build)
      : await handleApiRequest(request, env, fetchImpl, waitImpl);
  return withSecurityHeaders(response);
}
