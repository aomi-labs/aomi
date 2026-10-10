import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/launch/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/bff/deploy/routes");
        return handler.deploymentStatusRoute(request);
      },
    },
  },
});
