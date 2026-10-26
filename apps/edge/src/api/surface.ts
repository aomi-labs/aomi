/**
 * The api surface (api.aomi.dev): the public host for venues, the CLI and MCP.
 * A pure router over the backend pool, the API Server, the manager and the
 * payment service, plus the Task venue adapter (`./task`), which answers
 * venue discovery itself.
 */
import type { EdgeEnv } from "../env";
import { config } from "../kernel/config";
import { preflight, withCors } from "../kernel/cors";
import { EdgeError, errorResponse } from "../kernel/errors";
import { routingKeyFor } from "../kernel/pool";
import { proxy, target, type FetchLike } from "../kernel/proxy";
import { CORS, resolveRoute, TASK_BUILD_PATH, type Route } from "./routes";
import { adaptTaskBuild, taskDocument } from "./task";

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
        // Placement must not wait indefinitely for a hung pool member.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1_500);
        try {
          const response = await fetchImpl(new Request(probe, { signal: controller.signal }), { cache: "no-store" });
          void response.body?.cancel();
          return response.ok;
        } catch {
          return false;
        } finally {
          clearTimeout(timeout);
        }
      }),
    );
    const targets = route.targets.filter((_, index) => available[index]);
    if (targets.length) return targets;
    if (attempt + 1 < attempts && retryMs > 0) await waitImpl(retryMs);
  }
  throw new EdgeError(503, "app_unavailable");
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
    if (route.document) {
      return withCors(policy, request, await taskDocument(route.document, request, route.targets[0], env, fetchImpl), cfg);
    }
    let outbound = request;
    if (taskBuild) {
      const adapted = await adaptTaskBuild(request, route.targets[0], env, fetchImpl);
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
