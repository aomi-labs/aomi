import "@tanstack/react-start/server-only";

const ORIGIN = "https://aomilabs.mintlify.dev";
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

// Equivalent to Landing's docs rewrites, including the docs API bridge.
export async function proxyMintlify(request: Request): Promise<Response> {
  const source = new URL(request.url);
  if (
    !/^\/(?:docs|_mintlify)(?:\/|$)/.test(source.pathname) &&
    !source.pathname.startsWith("/mintlify-assets/") &&
    source.pathname !== "/api/request"
  )
    return Response.json({ error: "Not found" }, { status: 404 });
  if (!METHODS.includes(request.method))
    return new Response(null, {
      status: 405,
      headers: { Allow: METHODS.join(", ") },
    });

  const target = new URL(ORIGIN);
  target.pathname =
    source.pathname === "/api/request"
      ? "/_mintlify/api/request"
      : source.pathname;
  target.search = source.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    signal: request.signal,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  const upstream = await fetch(target, init);
  const responseHeaders = new Headers(upstream.headers);
  // Fetch decodes compressed bytes; carrying the wire length/encoding is invalid.
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  const location = responseHeaders.get("location");
  if (location) {
    const destination = new URL(location, target);
    if (destination.origin === ORIGIN)
      responseHeaders.set(
        "location",
        `${destination.pathname}${destination.search}${destination.hash}`,
      );
  }
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
