import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/auth/widget/oauth-bootstrap")({
  server: {
    handlers: {
      POST: ({ request }) => routes.oauthBootstrap.POST(request),
      OPTIONS: ({ request }) => routes.oauthBootstrap.OPTIONS(request),
    },
  },
});
