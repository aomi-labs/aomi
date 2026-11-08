import { withDatabase } from "@aomi-labs/account";
import { withAccountAuthEnv } from "@aomi-labs/account/better-auth";

import { handleApiRequest } from "./api/surface";
import { buildContext, isBuildHost } from "./build/context";
import { handleBuildRequest } from "./build/routes";
import type { EdgeEnv } from "./env";
import { headlessContext } from "./headless";
import { withSecurityHeaders } from "./kernel/cors";
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
  const headless = headlessContext(request, env, fetchImpl, waitImpl);
  const portal = headless ?? portalContext(request, env, fetchImpl, waitImpl);
  // The API host's issuer is request-scoped; Chat hosts keep the process configuration.
  const serveAccount = () =>
    headless
      ? withAccountAuthEnv(headless.env as unknown as Record<string, string | undefined>, () => handlePortalRequest(request, headless))
      : handlePortalRequest(request, portal!);
  // The account surface opens a pool over Hyperdrive on first use; it closes after the request.
  const database = env.HYPERDRIVE?.connectionString;
  if (portal && database)
    return withSecurityHeaders(await withDatabase(database, serveAccount, waitUntil));
  const build = portal ? null : buildContext(request, env, fetchImpl);
  // A Build host without its upstream fails closed instead of falling to the public API.
  if (!portal && !build && isBuildHost(env, new URL(request.url).host)) {
    const error = new EdgeError(503, "build_unconfigured");
    return withSecurityHeaders(errorResponse(error, { surface: "build", operation: "context", request }));
  }
  const response = portal
    ? await serveAccount()
    : build
      ? await handleBuildRequest(request, build)
      : isLandingHost(env, new URL(request.url).host)
        ? await handleLandingRequest(request, env, fetchImpl)
        : await handleApiRequest(request, env, fetchImpl, waitImpl);
  return withSecurityHeaders(response);
}
