import { checkRateLimit, getClientIp } from "@portal/lib/rate-limit";

/**
 * Per-IP rate limit for the *unauthenticated* widget-auth endpoints
 * (`exchange`, `siwe|siws nonce/verify`). These run before any bearer exists,
 * yet each one writes a `ba_verifications` row and does signature crypto / JWKS
 * fetches — and `exchange` can create a canonical user — so an unthrottled
 * caller can spam rows and burn CPU. The small in-process limiter is scoped to
 * this public pre-authentication boundary and keyed per client IP.
 *
 * Returned as a plain 429 `Response`; callers return it from inside the
 * `widgetRoute` handler so the wrapper still applies the cross-origin CORS
 * headers. A rate-limited response carries no `Access-Control-Allow-Credentials`
 * and preserves `Vary: Origin`, exactly like every other widget response.
 */
export function widgetAuthRateLimit(request: Request): Response | null {
  if (checkRateLimit(getClientIp(request)).allowed) return null;
  return Response.json({ error: "rate_limited" }, { status: 429 });
}
