import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/auth/widget/telegram/exchange")({
  server: {
    handlers: {
      POST: ({ request }) => routes.telegramExchange.POST(request),
      OPTIONS: ({ request }) => routes.telegramExchange.OPTIONS(request),
    },
  },
});
