/** Preserve the hosts' canonical-path redirects before page or BFF dispatch. */
export function trailingSlashRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  // Repeated slashes are normalized before the trailing-slash redirect.
  let pathname = url.pathname.replace(/\/\/+/g, "/");
  if (pathname === url.pathname) {
    if (pathname === "/" || !pathname.endsWith("/")) return null;
    pathname = pathname.slice(0, -1);
  }
  const location = `${pathname}${url.search}`;
  return new Response(new TextEncoder().encode(location), {
    status: 308,
    headers: { Location: location, Refresh: `0;url=${location}` },
  });
}
