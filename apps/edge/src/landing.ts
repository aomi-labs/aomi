/**
 * The Landing surface: its API consoles call the backend's public thread
 * routes anonymously (no account, no bearer); every other path, pages
 * included, passes through to the Landing app.
 */
import type { EdgeEnv } from "./env";
import { config } from "./kernel/config";
import { errorResponse } from "./kernel/errors";
import { rankedPool } from "./kernel/pool";
import { passThrough, proxy, target, type FetchLike } from "./kernel/proxy";
import { BACKEND_API_HEADERS } from "./portal/headers";

const ROUTES: readonly [RegExp, readonly string[]][] = [
  [/^\/api\/thread\/(?:state|updates|events|apps|models)$/, ["GET"]],
  [/^\/api\/thread\/(?:chat|interrupt|model)$/, ["POST"]],
  [/^\/api\/system$/, ["POST"]],
  [/^\/api\/exec\/simulate$/, ["POST"]],
  [/^\/api\/threads$/, ["GET", "POST"]],
  [/^\/api\/threads\/[^/]+$/, ["GET", "PATCH", "DELETE"]],
];

export function isLandingHost(env: EdgeEnv, host: string): boolean {
  return config(env).landing.hosts.has(host.toLowerCase());
}

export async function handleLandingRequest(request: Request, env: EdgeEnv, fetchImpl: FetchLike): Promise<Response> {
  const { pathname, search } = new URL(request.url);
  const { upstream } = config(env).landing;
  if (!ROUTES.some(([path, methods]) => path.test(pathname) && methods.includes(request.method)))
    return upstream
      ? passThrough(request, upstream, fetchImpl, "landing")
      : Response.json({ error: "not_found" }, { status: 404 });
  try {
    const targets = rankedPool(request, env).map((origin) => target(origin, pathname, search));
    return await proxy(request, targets, { fetchImpl, headers: BACKEND_API_HEADERS });
  } catch (error) {
    return errorResponse(error, { surface: "landing", operation: "proxy.request", request });
  }
}
