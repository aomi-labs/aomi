import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/auth/widget/telegram/custom-auth")({
  server: {
    handlers: {
      POST: ({ request }) => routes.telegramCustomAuth.POST(request),
      OPTIONS: ({ request }) => routes.telegramCustomAuth.OPTIONS(request),
    },
  },
});
