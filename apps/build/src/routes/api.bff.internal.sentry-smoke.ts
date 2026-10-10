import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/internal/sentry-smoke")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const handler = await import("@/server/http/sentry-smoke");
        return handler.POST(request);
      },
      GET: async () => {
        const handler = await import("@/server/http/sentry-smoke");
        return handler.GET();
      },
      PUT: async () => {
        const handler = await import("@/server/http/sentry-smoke");
        return handler.PUT();
      },
      PATCH: async () => {
        const handler = await import("@/server/http/sentry-smoke");
        return handler.PATCH();
      },
      DELETE: async () => {
        const handler = await import("@/server/http/sentry-smoke");
        return handler.DELETE();
      },
      OPTIONS: async () => {
        const handler = await import("@/server/http/sentry-smoke");
        return handler.OPTIONS();
      },
    },
  },
});
