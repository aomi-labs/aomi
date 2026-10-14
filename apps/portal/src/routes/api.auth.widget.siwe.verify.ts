import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/auth/widget/siwe/verify")({
  server: {
    handlers: {
      POST: ({ request }) => routes.siweVerify.POST(request),
      OPTIONS: ({ request }) => routes.siweVerify.OPTIONS(request),
    },
  },
});
