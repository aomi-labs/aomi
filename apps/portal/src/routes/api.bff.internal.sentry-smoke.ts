import { createFileRoute } from "@tanstack/react-router";
import { sentrySmoke } from "@/server/bff/sentry-smoke";

export const Route = createFileRoute("/api/bff/internal/sentry-smoke")({
  server: {
    handlers: {
      GET: () => sentrySmoke.GET(),
      POST: ({ request }) => sentrySmoke.POST(request),
      PUT: () => sentrySmoke.PUT(),
      PATCH: () => sentrySmoke.PATCH(),
      DELETE: () => sentrySmoke.DELETE(),
      OPTIONS: () => sentrySmoke.OPTIONS(),
    },
  },
});
