const HTTP_METHODS = [
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
];

interface NativeHttpRoute {
  options: { server?: { handlers?: object } };
  children?: unknown;
}

/** Keep unsupported BFF methods out of page SSR, preserving explicit handlers. */
export function installNativeHttpMethods(route: NativeHttpRoute): void {
  const handlers = route.options.server?.handlers;
  if (handlers && typeof handlers !== "function") {
    const declared: Record<string, unknown> = { ...handlers };
    if (!declared.OPTIONS) {
      const implemented = HTTP_METHODS.filter((method) => declared[method]);
      if (declared.GET && !declared.HEAD) implemented.push("HEAD");
      const allow = ["OPTIONS", ...implemented].sort().join(", ");
      Object.assign(handlers, {
        OPTIONS: () =>
          new Response(null, { status: 204, headers: { Allow: allow } }),
      });
    }
    if (!declared.ANY) {
      Object.assign(handlers, {
        ANY: ({ request }: { request: Request }) =>
          new Response(null, {
            status: HTTP_METHODS.includes(request.method) ? 405 : 400,
          }),
      });
    }
  }
  if (route.children && typeof route.children === "object") {
    for (const child of Object.values(route.children))
      installNativeHttpMethods(child);
  }
}

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
