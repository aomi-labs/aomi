import type { captureRequestError } from "@sentry/nextjs";

import { buildFailures } from "@/server/bff/failures";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    try {
      const { registerBunCompatHooks } = await import("./server/bun-compat");
      await registerBunCompatHooks();
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
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError: typeof captureRequestError = (
  error,
  request,
  errorContext,
) => {
  buildFailures.handle({
    source: "uncaught",
    error,
    request,
    errorContext,
    context: {
      routeFamily: errorContext.routePath || request.path,
      operation: "next.request_error",
      method: request.method,
    },
  });
};
