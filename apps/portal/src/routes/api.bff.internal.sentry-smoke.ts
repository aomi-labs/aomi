import { createFileRoute } from "@tanstack/react-router";
import { invokeHandler } from "@/server/http-handler";
import * as handlers from "@/server/http/api/bff/internal/sentry-smoke/route";

export const Route = createFileRoute("/api/bff/internal/sentry-smoke")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        invokeHandler(handlers.GET, request, params),
      POST: ({ request, params }) =>
        invokeHandler(handlers.POST, request, params),
      PUT: ({ request, params }) =>
        invokeHandler(handlers.PUT, request, params),
      PATCH: ({ request, params }) =>
        invokeHandler(handlers.PATCH, request, params),
      DELETE: ({ request, params }) =>
        invokeHandler(handlers.DELETE, request, params),
      OPTIONS: ({ request, params }) =>
        invokeHandler(handlers.OPTIONS, request, params),
    },
  },
});
