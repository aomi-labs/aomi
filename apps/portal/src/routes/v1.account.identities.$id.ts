import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/identities/$id")({
  server: {
    handlers: {
      PATCH: ({ request }) => routes.identity.PATCH(request),
      DELETE: ({ request }) => routes.identity.DELETE(request),
      OPTIONS: ({ request }) => routes.identity.OPTIONS(request),
    },
  },
});
