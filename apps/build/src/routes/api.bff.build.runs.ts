import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/build/runs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const handler = await import("@/server/bff/build/routes");
        return handler.createBuildRunRoute(request);
      },
      GET: async ({ request }) => {
        const handler = await import("@/server/bff/build/routes");
        return handler.buildRunStatusRoute(request);
      },
    },
  },
});
