import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/deployments/deploy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const handler = await import("@/server/bff/deploy/routes");
        return handler.deployRoute(false)(request);
      },
    },
  },
});
