import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/auth/widget/siws/verify")({
  server: {
    handlers: {
      POST: ({ request }) => routes.siwsVerify.POST(request),
      OPTIONS: ({ request }) => routes.siwsVerify.OPTIONS(request),
    },
  },
});
