import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/auth/widget/guest")({
  server: {
    handlers: {
      POST: ({ request }) => routes.widgetGuest.POST(request),
      OPTIONS: ({ request }) => routes.widgetGuest.OPTIONS(request),
    },
  },
});
