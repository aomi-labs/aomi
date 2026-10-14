import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/auth/widget/siwe/nonce")({
  server: {
    handlers: {
      POST: ({ request }) => routes.siweNonce.POST(request),
      OPTIONS: ({ request }) => routes.siweNonce.OPTIONS(request),
    },
  },
});
