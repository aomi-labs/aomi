import { wrapFetchWithSentry } from "@sentry/tanstackstart-react";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import {
  installNativeHttpMethods,
  trailingSlashRedirect,
} from "@aomi-labs/app-kit/http";
import { proxy } from "./proxy";
import { portalFailures } from "./server/bff/failures";
import {
  legacyDeploymentRedirect,
  protectBootstrapResponse,
} from "./server/http-policy";
import "./sentry.server.config";
const startHandler = (async () => {
  const { routeTree } = await import("./routeTree.gen");
  installNativeHttpMethods(routeTree);
  return (await import("@tanstack/react-start/server-entry")).default;
})();
export default createServerEntry({
  async fetch(request, options) {
    const url = new URL(request.url);
    const redirect =
      trailingSlashRedirect(request) ?? legacyDeploymentRedirect(request);
    if (redirect) return redirect;
    const sentryHandler = wrapFetchWithSentry({
      async fetch() {
        try {
          const upstream = /^\/(?:api|v1)(?:\/|$)/.test(url.pathname)
            ? await proxy(request)
            : null;
          const response =
            upstream ?? (await (await startHandler).fetch(request, options));
          // Start answers unmatched non-HTML requests with 406; API and
          // discovery clients expect a 404 to move on.
          if (
            response.status === 406 &&
            /^\/(?:api|v1|\.well-known)(?:\/|$)/.test(url.pathname)
          )
            return Response.json({ error: "not_found" }, { status: 404 });
          return protectBootstrapResponse(request, response);
        } catch (error) {
          portalFailures.handle({
            source: "uncaught",
            error,
            context: {
              routeFamily: url.pathname,
              operation: "start.request_error",
              method: request.method,
            },
          });
          throw error;
        }
      },
    });
    return sentryHandler.fetch(request);
  },
});
