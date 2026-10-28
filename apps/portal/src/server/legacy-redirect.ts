/** `/deployments*` moved to Build. */
export function legacyDeploymentRedirect(request: Request): Response | null {
  const { pathname, search } = new URL(request.url);
  const match = /^\/deployments(?:\/(new|[^/]+))?$/.exec(pathname);
  if (!match) return null;
  const build = new URL(process.env.AOMI_BUILD_URL || "https://build.aomi.dev")
    .origin;
  const path =
    match[1] === "new"
      ? "/operate/deployments/new"
      : match[1]
        ? `/projects/${match[1]}`
        : "/projects";
  return Response.redirect(`${build}${path}${search}`, 307);
}
