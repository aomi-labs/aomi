/**
 * The api surface (api.aomi.dev): the public host for venues, the CLI and MCP.
 * A pure router over the backend pool, the API Server, the manager and the
 * payment service, plus the Task venue adapter.
 */
import type { EdgeEnv } from "../env";
import { config } from "../kernel/config";
import { preflight, withCors } from "../kernel/cors";
import { EdgeError, errorResponse } from "../kernel/errors";
import { routingKeyFor } from "../kernel/pool";
import { proxy, target, type FetchLike } from "../kernel/proxy";
import { discoveryChallenge, discoveryResponse } from "./discovery";
import { CORS, resolveRoute, TASK_BUILD_PATH, type Route } from "./routes";
import { normaliseTaskBody } from "./task-body";

export type WaitLike = (delayMs: number) => Promise<unknown>;
export const wait: WaitLike = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

/**
 * Hosted-app placement: keep only the targets that hold the app's active
 * artifact right now. A miss wakes that backend's reconciler, so the request
 * waits at the edge (bounded) while a small artifact materializes.
 */
async function placed(route: Route, env: EdgeEnv, fetchImpl: FetchLike, waitImpl: WaitLike): Promise<URL[]> {
  if (!route.appId) return route.targets;
  const { attempts, retryMs } = config(env).warmup;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const available = await Promise.all(
      route.targets.map(async (url) => {
        // A dedicated probe, not /health: liveness stays a process-level signal.
        const probe = target(url.origin, "/availability", `?application_id=${encodeURIComponent(route.appId!)}`);
        try {
          const response = await fetchImpl(new Request(probe), { cache: "no-store" });
          void response.body?.cancel();
          return response.ok;
        } catch {
          return false;
        }
      }),
    );
    const targets = route.targets.filter((_, index) => available[index]);
    if (targets.length) return targets;
    if (attempt + 1 < attempts && retryMs > 0) await waitImpl(retryMs);
  }
  throw new EdgeError(503, "app_unavailable");
}

/**
 * Venues that discover by GET, HEAD or an empty POST get the API Server's own
 * cached, body-bound 402; a JSON body sent with the wrong label is relabelled.
 * Null means: forward the request as it is.
 */
async function adaptTaskBuild(
  request: Request,
  route: Route,
  env: EdgeEnv,
  fetchImpl: FetchLike,
): Promise<{ respond: Response } | { forward: Request }> {
  const apiServer = new URL(route.targets[0].origin);
  const probe = request.method === "GET" || request.method === "HEAD";
  if (!probe && request.method !== "POST") return { forward: request };
  const body = probe ? null : await normaliseTaskBody(request);
  if (body && body.kind !== "empty") return { forward: body.request };
  const challenge = await discoveryChallenge(apiServer, env, fetchImpl);
  return challenge ? { respond: discoveryResponse(challenge, request.method) } : { forward: request };
}

export async function handleApiRequest(
  request: Request,
  env: EdgeEnv,
  fetchImpl: FetchLike,
  waitImpl: WaitLike,
): Promise<Response> {
  const url = new URL(request.url);
  const route = resolveRoute(url, env, routingKeyFor(request, url));
  if (!route) return new Response("Not found", { status: 404 });

  // GET on the Task build is discovery; POST is the payable operation. A
  // preflight follows the method it asks about.
  const method =
    request.method === "OPTIONS"
      ? request.headers.get("access-control-request-method")?.toUpperCase()
      : request.method;
  const taskBuild = route.name === "task" && url.pathname === TASK_BUILD_PATH;
  const policy = CORS[taskBuild && (method === "GET" || method === "HEAD") ? "task-discovery" : route.name];
  const cfg = config(env);

  if (route.methods && method && !route.methods.includes(method))
    return withCors(
      policy,
      request,
      new Response("Method not allowed", { status: 405, headers: { allow: route.methods.join(", ") } }),
      cfg,
    );
  if (request.method === "OPTIONS") return preflight(policy, request, cfg);

  let response: Response;
  try {
    let outbound = request;
    if (taskBuild) {
      const adapted = await adaptTaskBuild(request, route, env, fetchImpl);
      if ("respond" in adapted) return withCors(policy, request, adapted.respond, cfg);
      outbound = adapted.forward;
    }
    response = await proxy(outbound, await placed(route, env, fetchImpl, waitImpl), {
      fetchImpl,
      headers: route.headers,
      forwarded: true,
    });
  } catch (error) {
    response = errorResponse(error, { surface: "api", operation: route.name, request });
  }
  return response.status === 101 ? response : withCors(policy, request, response, cfg);
}
