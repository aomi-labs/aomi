import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/wallets/link")({
  server: {
    handlers: {
      GET: ({ request }) => routes.walletLink.GET(request),
      POST: ({ request }) => routes.walletLink.POST(request),
      OPTIONS: ({ request }) => routes.walletLink.OPTIONS(request),
    },
  },
});
