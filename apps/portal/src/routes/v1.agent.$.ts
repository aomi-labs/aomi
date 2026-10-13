import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/agent/$")({
  server: {
    handlers: {
      GET: ({ request }) => routes.agent.GET(request),
      POST: ({ request }) => routes.agent.POST(request),
      PATCH: ({ request }) => routes.agent.PATCH(request),
      DELETE: ({ request }) => routes.agent.DELETE(request),
      OPTIONS: ({ request }) => routes.agent.OPTIONS(request),
    },
  },
});
