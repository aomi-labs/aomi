import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/widget-fixture/$scenario")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const handler = await import("@/server/widget-fixture");
        return handler.GET(request, { scenario: params.scenario });
      },
      POST: async ({ request, params }) => {
        const handler = await import("@/server/widget-fixture");
        return handler.POST(request, { scenario: params.scenario });
      },
    },
  },
});
