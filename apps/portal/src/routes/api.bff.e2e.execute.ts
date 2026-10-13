import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/bff/e2e/execute")({
  server: {
    handlers: {
      POST: ({ request }) => routes.e2eExecute.POST(request),
    },
  },
});
