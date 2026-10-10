import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/apps/$")({
  server: {
    handlers: {
      GET: ({ request }) => routes.accountApps.GET(request),
      POST: ({ request }) => routes.accountApps.POST(request),
      DELETE: ({ request }) => routes.accountApps.DELETE(request),
      OPTIONS: ({ request }) => routes.accountApps.OPTIONS(request),
    },
  },
});
