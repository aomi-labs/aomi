import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/.well-known/api-catalog")({
  server: {
    handlers: {
      GET: ({ request }) => routes.discovery.GET(request),
    },
  },
});
