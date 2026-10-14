import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/auth/widget/session")({
  server: {
    handlers: {
      DELETE: ({ request }) => routes.widgetSession.DELETE(request),
      OPTIONS: ({ request }) => routes.widgetSession.OPTIONS(request),
    },
  },
});
