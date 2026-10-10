import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/build/runs/decision")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const handler = await import("@/server/bff/build/routes");
        return handler.buildRunDecisionRoute(request);
      },
    },
  },
});
