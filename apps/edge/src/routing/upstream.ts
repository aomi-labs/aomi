import type { EdgeEnv } from "../env";
import { buildRoute, buildTargetUrl, type Route, type UpstreamHeaderPolicy } from "./routes";

export type FetchLike = (
  request: Request,
  init?: RequestInit,
) => Promise<Response>;
export type WaitLike = (delayMs: number) => Promise<unknown>;

function appendForwardedFor(existing: string | null, clientIp: string): string {
  return existing ? `${existing}, ${clientIp}` : clientIp;
}

function upstreamHeaders(
  request: Request,
  policy: UpstreamHeaderPolicy | undefined,
): Headers {
  if (!policy) return new Headers(request.headers);
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    if (policy.has(name.toLowerCase())) headers.set(name, value);
  });
  return headers;
}

export function buildUpstreamRequest(
  request: Request,
  targetUrl: URL,
  policy?: UpstreamHeaderPolicy,
): Request {
  const headers = upstreamHeaders(request, policy);
  const clientIp = request.headers.get("CF-Connecting-IP");

  headers.set(
    "X-Forwarded-Proto",
    new URL(request.url).protocol.replace(":", ""),
  );
  if (clientIp) {
    headers.set("X-Real-IP", clientIp);
    headers.set(
      "X-Forwarded-For",
      appendForwardedFor(request.headers.get("X-Forwarded-For"), clientIp),
    );
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = request.body;
    // Streaming request bodies require half duplex per the fetch spec;
    // workerd accepts it and Node (tests) requires it.
    init.duplex = "half";
  }
  return new Request(targetUrl.toString(), init);
}

// Statuses that mean "this origin's tunnel is down", not "the backend
// answered": worth retrying on the next origin in rendezvous order.
const FAILOVER_STATUSES = new Set([502, 503, 521, 522, 523, 530]);
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function fetchWithFailover(
  request: Request,
  route: Route,
  fetchImpl: FetchLike,
): Promise<Response> {
  const targets = [route.targetUrl, ...route.fallbackUrls];
  let lastError: unknown = null;

  for (let i = 0; i < targets.length; i += 1) {
    const isLast = i === targets.length - 1;
    // Clone per attempt so a retry still has an unconsumed body.
    const upstreamRequest = buildUpstreamRequest(
      request.clone(),
      targets[i],
      route.upstreamHeaders,
    );
    let response: Response;
    try {
      response = await fetchImpl(upstreamRequest, { cache: "no-store" });
    } catch (error) {
      lastError = error;
      if (isLast || !IDEMPOTENT_METHODS.has(request.method)) throw error;
      // Ambiguous edge/origin failure: only replay methods that are safe to
      // send more than once.
      continue;
    }
    if (
      !isLast &&
      FAILOVER_STATUSES.has(response.status) &&
      IDEMPOTENT_METHODS.has(request.method)
    ) {
      // A tunnel-down status after the request left the edge: only retry
      // methods that are safe to replay.
      continue;
    }
    return response;
  }

  throw lastError ?? new Error("no backend origins configured");
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function constrainRouteToAvailableApp(
  route: Route,
  env: EdgeEnv,
  fetchImpl: FetchLike,
  waitImpl: WaitLike,
): Promise<Route | null> {
  if (!route.appId || !route.backendOrigins?.length) return route;

  const attempts = boundedInteger(env.HOSTED_APP_WARMUP_ATTEMPTS, 1, 1, 10);
  const retryMs = boundedInteger(env.HOSTED_APP_WARMUP_RETRY_MS, 0, 0, 2_000);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const availability = await Promise.all(
      route.backendOrigins.map(async (origin) => {
        // Dedicated placement probe, not /health: liveness must stay a
        // process-level signal, while this answers "does this host hold the
        // app's active artifact right now" and 404s when it does not. A miss
        // also wakes that backend's reconciler, so the next probe can observe
        // the artifact as soon as it materializes.
        const probeUrl = buildTargetUrl(
          origin,
          "/availability",
          `?application_id=${encodeURIComponent(route.appId ?? "")}`,
        );
        try {
          const response = await fetchImpl(new Request(probeUrl.toString()), {
            cache: "no-store",
          });
          // Consume neither response body nor a cached answer: this is a
          // strict per-request placement check.
          void response.body?.cancel();
          return response.ok;
        } catch {
          return false;
        }
      }),
    );

    const targets = [route.targetUrl, ...route.fallbackUrls].filter(
      (_target, index) => availability[index],
    );
    if (targets.length) {
      return buildRoute(targets[0], route.corsProfile, targets.slice(1), {
        upstreamHeaders: route.upstreamHeaders,
      });
    }
    if (attempt + 1 < attempts && retryMs > 0) await waitImpl(retryMs);
  }

  return null;
}
