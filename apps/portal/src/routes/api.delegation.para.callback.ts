import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

const callback = routes.delegationCallback("para");

export const Route = createFileRoute("/api/delegation/para/callback")({
  server: {
    handlers: {
      POST: ({ request }) => callback.POST(request),
    },
  },
});
