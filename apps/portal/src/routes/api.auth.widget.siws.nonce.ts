import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/auth/widget/siws/nonce")({
  server: {
    handlers: {
      POST: ({ request }) => routes.siwsNonce.POST(request),
      OPTIONS: ({ request }) => routes.siwsNonce.OPTIONS(request),
    },
  },
});
