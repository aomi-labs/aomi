import { createServerEntry } from "@tanstack/react-start/server-entry";
import {
  installNativeHttpMethods,
  trailingSlashRedirect,
} from "@aomi-labs/app-kit/http";
import { portalFailures } from "./server/failures";
import { legacyDeploymentRedirect } from "./server/legacy-redirect";
import "./sentry.server.config";

const startHandler = (async () => {
  const { routeTree } = await import("./routeTree.gen");
  installNativeHttpMethods(routeTree);
  return (await import("@tanstack/react-start/server-entry")).default;
})();

/** The portal serves pages only; the Edge owns these paths. */
const EDGE_PATHS = /^\/(?:api|v1|\.well-known)(?:\/|$)/;

export default createServerEntry({
  async fetch(request, options) {
    const redirect =
      trailingSlashRedirect(request) ?? legacyDeploymentRedirect(request);
    if (redirect) return redirect;
    const { pathname } = new URL(request.url);
    try {
      const response = await (await startHandler).fetch(request, options);
      // Start answers unmatched non-HTML requests with 406; API clients that
      // reach the app expect a 404.
      if (response.status === 406 && EDGE_PATHS.test(pathname))
        return Response.json({ error: "not_found" }, { status: 404 });
      return response;
    } catch (error) {
      portalFailures.handle({
        source: "uncaught",
        error,
        context: {
          routeFamily: pathname,
          operation: "start.request_error",
          method: request.method,
        },
      });
      throw error;
    }
  },
});
