import type { FetchLike } from "./routing/upstream";

/**
 * Hand a request on an app origin to the Vercel app unchanged (headers,
 * cookies, body), with forwarding metadata so the app sees its public host.
 * Everything the edge does not serve itself on an app host ends here.
 */
export async function passThrough(
  request: Request,
  upstreamOrigin: string,
  fetchImpl: FetchLike,
  surface: string,
): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, upstreamOrigin);
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) {
    headers.set("x-real-ip", clientIp);
    const existing = request.headers.get("x-forwarded-for");
    headers.set("x-forwarded-for", existing ? `${existing}, ${clientIp}` : clientIp);
  }
  const init: RequestInit & { duplex?: "half" } = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }
  try {
    return await fetchImpl(new Request(target, init), { cache: "no-store" });
  } catch (error) {
    console.error(`edge.${surface}.passthrough_unreachable`, {
      path: incoming.pathname,
      cause: String((error as Error | undefined)?.message ?? error),
    });
    return Response.json({ error: "upstream_unavailable" }, { status: 502 });
  }
}
