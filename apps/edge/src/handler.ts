import type { EdgeEnv } from "./env";
import {
  createPreflightResponse,
  decorateResponse,
  notFound,
} from "./routing/cors";
import { routingKeyFor } from "./routing/pool";
import {
  paymentMethods,
  resolveRoute,
  TASK_BUILD_PATH,
  type CorsProfile,
  type Route,
} from "./routing/routes";
import {
  constrainRouteToAvailableApp,
  fetchWithFailover,
  wait,
  type FetchLike,
  type WaitLike,
} from "./routing/upstream";
import { normaliseTaskBody } from "./task/body";
import { discoveryChallenge, discoveryResponse } from "./task/discovery";

export type { EdgeEnv } from "./env";

function requestedMethod(request: Request): string | undefined {
  return request.method === "OPTIONS"
    ? request.headers.get("Access-Control-Request-Method")?.toUpperCase()
    : request.method;
}

/**
 * Task build: the venue-facing shape of the one payable POST. Returns the
 * response to send when the request ends at the edge, or the request to
 * forward (possibly relabelled) when it should reach the API Server.
 */
async function adaptTaskBuild(
  request: Request,
  route: Route,
  env: EdgeEnv,
  fetchImpl: FetchLike,
): Promise<{ respond: Response } | { forward: Request }> {
  const apiServer = new URL(route.targetUrl.origin);
  if (request.method === "GET" || request.method === "HEAD") {
    // Venues that discover by GET expect the 402 itself, not a description of
    // it. The API Server's GET stays read-only metadata by design, so the
    // edge answers with its cached, body-bound challenge and falls back to the
    // metadata when no challenge can be had.
    const challenge = await discoveryChallenge(apiServer, env, fetchImpl);
    return challenge
      ? { respond: discoveryResponse(challenge, request.method) }
      : { forward: request };
  }
  if (request.method !== "POST") return { forward: request };
  const body = await normaliseTaskBody(request);
  if (body.kind === "empty") {
    const challenge = await discoveryChallenge(apiServer, env, fetchImpl);
    return challenge
      ? { respond: discoveryResponse(challenge, request.method) }
      : { forward: request };
  }
  return { forward: body.request };
}

export async function handleRequest(
  request: Request,
  env: EdgeEnv,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  waitImpl: WaitLike = wait,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  let route = resolveRoute(url, env, routingKeyFor(request, url));
  if (!route) return notFound();

  // The public GET is discovery. POST is the payable operation and retains the
  // restricted Task origin policy. Preflight must follow the requested method.
  const taskBuild =
    url.pathname === TASK_BUILD_PATH && route.corsProfile === "task";
  const method = requestedMethod(request);
  const discovery = method === "GET" || method === "HEAD";
  const corsProfile: CorsProfile =
    taskBuild && discovery ? "task-discovery" : route.corsProfile;

  const allowed = corsProfile === "payment" ? paymentMethods(url.pathname) : null;
  if (allowed && method && !allowed.split(", ").includes(method)) {
    return decorateResponse(
      new Response("Method not allowed", { status: 405, headers: { Allow: allowed } }),
      origin,
      env,
      corsProfile,
    );
  }

  if (request.method === "OPTIONS") {
    return createPreflightResponse(origin, env, corsProfile);
  }

  let outbound = request;
  if (taskBuild) {
    const adapted = await adaptTaskBuild(request, route, env, fetchImpl);
    if ("respond" in adapted) {
      return decorateResponse(adapted.respond, origin, env, corsProfile);
    }
    outbound = adapted.forward;
  }

  const placed = await constrainRouteToAvailableApp(route, env, fetchImpl, waitImpl);
  if (!placed) {
    return decorateResponse(
      new Response("Hosted application is unavailable on every backend origin", {
        status: 503,
      }),
      origin,
      env,
      "api",
    );
  }
  route = placed;

  const upstreamResponse = await fetchWithFailover(outbound, route, fetchImpl);
  if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return upstreamResponse;
  }
  return decorateResponse(upstreamResponse, origin, env, corsProfile);
}
