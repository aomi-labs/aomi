import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/launch/activate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const handler = await import("@/server/bff/deploy/routes");
        return handler.activateRoute(request);
      },
    },
  },
});
