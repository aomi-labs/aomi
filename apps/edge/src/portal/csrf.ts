/**
 * A browser attaches cookies to cross-site requests, so a cookie-authenticated
 * write must prove it comes from one of the app's own origins. Same rule as
 * `@aomi-labs/account/csrf`.
 */
export function cookieWriteAllowed(
  request: Request,
  trustedOrigins: readonly string[] = [],
): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const expected = new Set([new URL(request.url).origin, ...trustedOrigins]);
  const claimed = request.headers.get("origin") ?? request.headers.get("referer");
  if (claimed !== null) {
    try {
      return expected.has(new URL(claimed).origin);
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  return fetchSite === "same-origin" || request.headers.get("x-aomi-csrf") === "1";
}

const LOCAL_WIDGET_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The request's Origin when it is a usable https (or local http) origin. */
export function observedOrigin(request: Request): string | null {
  const raw = request.headers.get("origin");
  if (!raw || raw === "null") return null;
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    return null;
  }
  if (origin.origin !== raw) return null;
  if (origin.protocol === "https:") return origin.origin;
  if (origin.protocol === "http:" && LOCAL_WIDGET_HOSTS.has(origin.hostname))
    return origin.origin;
  return null;
}
