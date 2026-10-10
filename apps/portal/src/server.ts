import { wrapFetchWithSentry } from "@sentry/tanstackstart-react";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import {
  installNativeHttpMethods,
  trailingSlashRedirect,
} from "@aomi-labs/account/server";
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
