import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/merge")({
  server: {
    handlers: {
      POST: ({ request }) => routes.merge.POST(request),
      OPTIONS: ({ request }) => routes.merge.OPTIONS(request),
    },
  },
});
