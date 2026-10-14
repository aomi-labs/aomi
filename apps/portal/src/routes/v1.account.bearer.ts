import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/bearer")({
  server: {
    handlers: {
      GET: ({ request }) => routes.bearer.GET(request),
      OPTIONS: ({ request }) => routes.bearer.OPTIONS(request),
    },
  },
});
