import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/agent/mcp")({
  server: {
    handlers: {
      POST: ({ request }) => routes.agentMcp.POST(request),
    },
  },
});
