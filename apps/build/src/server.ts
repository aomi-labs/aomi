import { wrapFetchWithSentry } from "@sentry/tanstackstart-react";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import {
  installNativeHttpMethods,
  trailingSlashRedirect,
} from "@aomi-labs/account/server";
import { registerBunCompatHooks } from "./server/bun-compat";
import { buildFailures } from "./server/bff/failures";

// The external Smithers modules must load after their Node compatibility hooks.
const initialized = (async () => {
  try {
    await registerBunCompatHooks();
    await import("./sentry.server.config");
    const { routeTree } = await import("./routeTree.gen");
    installNativeHttpMethods(routeTree);
  } catch (error) {
    buildFailures.handle({
      source: "local",
      error,
      handled: false,
      context: {
        routeFamily: "/instrumentation",
        operation: "register_bun_compat",
      },
    });
    throw error;
  }
})();

export default createServerEntry({
  async fetch(request, options) {
    const redirect = trailingSlashRedirect(request);
    if (redirect) return redirect;
    const sentryHandler = wrapFetchWithSentry({
      async fetch() {
        await initialized;
        try {
          const { default: handler } =
            await import("@tanstack/react-start/server-entry");
          const response = await handler.fetch(request, options);
          const headers = new Headers(response.headers);
          if (!headers.has("Cache-Control"))
            headers.set("Cache-Control", "private, no-store");
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        } catch (error) {
          const path = new URL(request.url).pathname;
          buildFailures.handle({
            source: "uncaught",
            error,
            context: {
              routeFamily: path,
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
