import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/session/cli")({
  server: {
    handlers: {
      POST: ({ request }) => routes.cliSession.POST(request),
      OPTIONS: ({ request }) => routes.cliSession.OPTIONS(request),
    },
  },
});
