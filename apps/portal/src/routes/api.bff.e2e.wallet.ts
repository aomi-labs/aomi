import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/bff/e2e/wallet")({
  server: {
    handlers: {
      GET: ({ request }) => routes.e2eWallet.GET(request),
    },
  },
});
