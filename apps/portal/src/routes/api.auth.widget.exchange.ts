import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/auth/widget/exchange")({
  server: {
    handlers: {
      POST: ({ request }) => routes.widgetExchange.POST(request),
      OPTIONS: ({ request }) => routes.widgetExchange.OPTIONS(request),
    },
  },
});
