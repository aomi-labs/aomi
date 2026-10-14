/**
 * A browser attaches cookies to cross-site requests, so a cookie-authenticated
 * write must prove it comes from one of the app's own origins.
 */
export function cookieWriteAllowed(
  request: Request,
  trustedOrigins: readonly string[] = [],
): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const expected = new Set([new URL(request.url).origin, ...trustedOrigins]);
  const claimed =
    request.headers.get("origin") ?? request.headers.get("referer");
  if (claimed !== null) {
    try {
      return expected.has(new URL(claimed).origin);
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  return (
    fetchSite === "same-origin" || request.headers.get("x-aomi-csrf") === "1"
  );
}
