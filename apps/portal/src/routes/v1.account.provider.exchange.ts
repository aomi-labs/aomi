import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/provider/exchange")({
  server: {
    handlers: {
      POST: ({ request }) => routes.providerLink.POST(request),
      OPTIONS: ({ request }) => routes.providerLink.OPTIONS(request),
    },
  },
});
