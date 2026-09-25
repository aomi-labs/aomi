/** Exact public app operations; credentials never inherit Credit Bank scopes. */
export function accountAppsScope(
  method: string,
  pathname: string,
): string | null {
  if (pathname === "/v1/account/apps") {
    return method === "GET" ? "account:apps:read" : null;
  }
  if (/^\/v1\/account\/apps\/[1-9]\d*$/.test(pathname)) {
    return method === "POST" || method === "DELETE"
      ? "account:apps:write"
      : null;
  }
  if (/^\/v1\/account\/apps\/[1-9]\d*\/secrets$/.test(pathname)) {
    if (method === "GET") return "account:credentials:read";
    return method === "POST" || method === "DELETE"
      ? "account:credentials:write"
      : null;
  }
  if (
    /^\/v1\/account\/apps\/[1-9]\d*\/secrets\/[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(
      pathname,
    )
  ) {
    return method === "DELETE" ? "account:credentials:write" : null;
  }
  return null;
}
