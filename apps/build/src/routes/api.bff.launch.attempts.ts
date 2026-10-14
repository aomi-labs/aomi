import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/launch/attempts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/bff/deploy/attempts");
        return handler.deploymentAttemptsRoute(request);
      },
      POST: async ({ request }) => {
        const handler = await import("@/server/bff/deploy/attempts");
        return handler.deploymentAttemptsRoute(request);
      },
    },
  },
});
