import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account")({
  server: {
    handlers: {
      GET: ({ request }) => routes.account.GET(request),
      PATCH: ({ request }) => routes.account.PATCH(request),
      DELETE: ({ request }) => routes.account.DELETE(request),
      OPTIONS: ({ request }) => routes.account.OPTIONS(request),
    },
  },
});
