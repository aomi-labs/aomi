import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/credits")({
  server: {
    handlers: {
      GET: ({ request }) => routes.credits.GET(request),
      OPTIONS: ({ request }) => routes.credits.OPTIONS(request),
    },
  },
});
