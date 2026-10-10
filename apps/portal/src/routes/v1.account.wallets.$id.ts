import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/wallets/$id")({
  server: {
    handlers: {
      PATCH: ({ request }) => routes.wallet.PATCH(request),
      DELETE: ({ request }) => routes.wallet.DELETE(request),
      OPTIONS: ({ request }) => routes.wallet.OPTIONS(request),
    },
  },
});
