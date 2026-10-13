import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/device-auth/exchange")({
  server: {
    handlers: {
      POST: ({ request }) => routes.deviceExchange.POST(request),
    },
  },
});
