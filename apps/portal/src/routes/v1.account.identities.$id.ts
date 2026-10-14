import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/identities/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        routes.identity.PATCH(request, { params: Promise.resolve(params) }),
      DELETE: ({ request, params }) =>
        routes.identity.DELETE(request, { params: Promise.resolve(params) }),
      OPTIONS: ({ request }) => routes.identity.OPTIONS(request),
    },
  },
});
