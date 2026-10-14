import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/wallets/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        routes.wallet.PATCH(request, { params: Promise.resolve(params) }),
      DELETE: ({ request, params }) =>
        routes.wallet.DELETE(request, { params: Promise.resolve(params) }),
      OPTIONS: ({ request }) => routes.wallet.OPTIONS(request),
    },
  },
});
