import { errorResponse, unreachable } from "./errors";

export type FetchLike = (request: Request, init?: RequestInit) => Promise<Response>;

/** Which headers cross the edge in each direction; an absent side passes all. */
export type HeaderPolicy = {
  request?: ReadonlySet<string>;
  response?: ReadonlySet<string>;
};

export type ProxyOptions = {
  fetchImpl: FetchLike;
  headers?: HeaderPolicy;
  /** Replaces the caller's Authorization (which a request policy normally drops). */
  bearer?: string;
  /** Headers the edge sets itself, after the policy. */
  set?: Record<string, string>;
  /** Add X-Forwarded-Proto / X-Real-IP / X-Forwarded-For (and X-Forwarded-Host when "host"). */
  forwarded?: boolean | "host";
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// "This origin's tunnel is down", not "the backend answered": worth trying the next origin.
const FAILOVER_STATUSES = new Set([502, 503, 521, 522, 523, 530]);
const CDN_CACHE_HEADERS = ["cdn-cache-control", "vercel-cdn-cache-control"];

function pick(source: Headers, allowed: ReadonlySet<string> | undefined): Headers {
  if (!allowed) return new Headers(source);
  const picked = new Headers();
  source.forEach((value, name) => {
    if (allowed.has(name.toLowerCase())) picked.set(name, value);
  });
  return picked;
}

function outbound(request: Request, target: URL, options: ProxyOptions): Request {
  const headers = pick(request.headers, options.headers?.request);
  if (options.bearer) headers.set("authorization", `Bearer ${options.bearer}`);
  if (options.forwarded) {
    const incoming = new URL(request.url);
    headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
    if (options.forwarded === "host") headers.set("x-forwarded-host", incoming.host);
    const clientIp = request.headers.get("cf-connecting-ip");
    if (clientIp) {
      headers.set("x-real-ip", clientIp);
      const chain = request.headers.get("x-forwarded-for");
      headers.set("x-forwarded-for", chain ? `${chain}, ${clientIp}` : clientIp);
    }
  }
  for (const [name, value] of Object.entries(options.set ?? {})) headers.set(name, value);
  const init: RequestInit & { duplex?: "half" } = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // Streaming request bodies need half duplex: workerd accepts it, Node requires it.
    init.duplex = "half";
  }
  return new Request(target, init);
}

function inbound(upstream: Response, options: ProxyOptions): Response {
  const headers = pick(upstream.headers, options.headers?.response);
  if (headers.get("content-type")?.includes("text/event-stream")) {
    headers.set("cache-control", "no-cache, no-transform");
    for (const name of CDN_CACHE_HEADERS) headers.delete(name);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

/**
 * Send a request to the first target and, for safe methods only, fail over to
 * the next one when the target is unreachable or its tunnel is down. A body is
 * never replayed. Throws `upstream_unavailable` when no target answers.
 */
export async function proxy(
  request: Request,
  targets: URL | readonly URL[],
  options: ProxyOptions,
): Promise<Response> {
  const list = Array.isArray(targets) ? targets : [targets as URL];
  if (list.length === 0) throw unreachable(new Error("no upstream origin configured"));
  const replayable = SAFE_METHODS.has(request.method);
  let lastError: unknown;
  for (const [index, target] of list.entries()) {
    const last = index === list.length - 1;
    const attempt = last ? request : request.clone();
    let response: Response;
    try {
      response = await options.fetchImpl(outbound(attempt, target, options), { cache: "no-store" });
    } catch (error) {
      lastError = error;
      if (last || !replayable) break;
      continue;
    }
    if (!last && replayable && FAILOVER_STATUSES.has(response.status)) {
      void response.body?.cancel();
      continue;
    }
    // Upgrades carry a socket the Response constructor cannot copy.
    if (response.status === 101) return response;
    return inbound(response, options);
  }
  throw unreachable(lastError);
}

/** `path` (absolute) and `search` under `origin`, keeping any base path the origin has. */
export function target(origin: string, path: string, search = ""): URL {
  const url = new URL(origin);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  url.search = search;
  return url;
}

/**
 * Hand a request on an app origin to its Vercel app unchanged (headers,
 * cookies, body), with forwarding metadata so the app sees its public host.
 */
export async function passThrough(
  request: Request,
  upstreamOrigin: string,
  fetchImpl: FetchLike,
  surface: string,
): Promise<Response> {
  const url = new URL(request.url);
  try {
    return await proxy(request, target(upstreamOrigin, url.pathname, url.search), { fetchImpl, forwarded: "host" });
  } catch (error) {
    return errorResponse(error, { surface, operation: "passthrough", request });
  }
}
