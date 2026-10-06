import type { captureRequestError } from "@sentry/nextjs";

import { portalFailures } from "@/server/bff/failures";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
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
  portalFailures.handle({
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
