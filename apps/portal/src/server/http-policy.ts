export function legacyDeploymentRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (
    url.pathname !== "/deployments" &&
    !url.pathname.startsWith("/deployments/")
  )
    return null;
  const origin = new URL(process.env.AOMI_BUILD_URL || "https://build.aomi.dev")
    .origin;
  const path =
    url.pathname === "/deployments/new"
      ? "/operate/deployments/new"
      : url.pathname === "/deployments"
        ? "/projects"
        : `/projects/${url.pathname.slice("/deployments/".length)}`;
  return new Response(null, {
    status: 307,
    headers: { Location: `${origin}${path}${url.search}` },
  });
}

export function protectBootstrapResponse(
  request: Request,
  response: Response,
): Response {
  if (new URL(request.url).pathname !== "/oauth/bootstrap") return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set(
    "Content-Security-Policy",
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
