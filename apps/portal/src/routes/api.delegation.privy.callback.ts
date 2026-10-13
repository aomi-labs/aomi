import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

const callback = routes.delegationCallback("privy");

export const Route = createFileRoute("/api/delegation/privy/callback")({
  server: {
    handlers: {
      POST: ({ request }) => callback.POST(request),
      OPTIONS: ({ request }) => callback.OPTIONS(request),
    },
  },
});
