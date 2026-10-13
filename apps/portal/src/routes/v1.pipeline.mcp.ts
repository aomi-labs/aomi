import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/pipeline/mcp")({
  server: {
    handlers: {
      POST: ({ request }) => routes.pipelineMcp.POST(request),
    },
  },
});
