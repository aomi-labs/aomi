import { NextRequest, NextResponse } from "next/server";
import { hostedPortalOrigin } from "./lib/hosted-portal";

/** Local UI review without copying a hosted database or auth signing secrets.
 * The fixed upstream still verifies every caller's origin-bound widget bearer.
 */
export async function proxy(request: NextRequest) {
  const upstream = hostedPortalOrigin();
  if (!upstream) return NextResponse.next();
  const origin =
    request.headers.get("origin") ??
    (request.headers.get("referer")
      ? new URL(request.headers.get("referer")!).origin
      : request.nextUrl.origin);
  const cors = new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Aomi-App-Key, Last-Event-ID, DPoP, Idempotency-Key, Payment-Signature, X-Aomi-CSRF, X-Aomi-Inference-Funding, X-Request-Id, X-Session-Id, X-Thread-Id",
    "Access-Control-Expose-Headers":
      "Payment-Required, Payment-Receipt, Payment-Response, X-Payment-Response, Retry-After, X-Request-Id",
    Vary: "Origin",
    "Cache-Control": "no-store",
  });
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  const headers = new Headers(request.headers);
  for (const name of [
    "host",
    "cookie",
    "connection",
    "content-length",
    "accept-encoding",
  ])
    headers.delete(name);
  headers.set("origin", origin);
  const target = new URL(
    request.nextUrl.pathname + request.nextUrl.search,
    upstream,
  );
  let response: Response;
  try { response = await fetch(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await request.arrayBuffer(),
    redirect: "manual",
    cache: "no-store",
  }); } catch {
    return Response.json({ error: "Hosted Portal is unavailable" }, { status: 502, headers: cors });
  }
  const outgoing = new Headers(response.headers);
  for (const name of [
    "set-cookie",
    "content-encoding",
    "content-length",
    "transfer-encoding",
    "access-control-allow-credentials",
  ])
    outgoing.delete(name);
  cors.forEach((value, name) => outgoing.set(name, value));
  return new Response(response.body, {
    status: response.status,
    headers: outgoing,
  });
}

export const config = { matcher: ["/api/:path*", "/v1/:path*"] };
