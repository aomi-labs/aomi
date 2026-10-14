import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: ({ request }) => routes.backend.GET(request),
      POST: ({ request }) => routes.backend.POST(request),
      PUT: ({ request }) => routes.backend.PUT(request),
      PATCH: ({ request }) => routes.backend.PATCH(request),
      DELETE: ({ request }) => routes.backend.DELETE(request),
      OPTIONS: ({ request }) => routes.backend.OPTIONS(request),
    },
  },
});
