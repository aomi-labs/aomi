import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute(
  "/api/auth/widget/telegram/custom-auth/jwks",
)({
  server: {
    handlers: {
      GET: ({ request }) => routes.telegramCustomAuthKeys.GET(request),
    },
  },
});
