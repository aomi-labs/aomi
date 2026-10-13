import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/bff/e2e/solana")({
  server: {
    handlers: {
      POST: ({ request }) => routes.e2eSolana.POST(request),
    },
  },
});
