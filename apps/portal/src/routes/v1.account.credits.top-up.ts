import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/credits/top-up")({
  server: {
    handlers: {
      POST: ({ request }) => routes.topUp.POST(request),
      OPTIONS: ({ request }) => routes.topUp.OPTIONS(request),
    },
  },
});
