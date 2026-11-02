import { createFileRoute } from "@tanstack/react-router";

const load = () => import("@/server/build/routes");

export const Route = createFileRoute("/api/build/runs/decision")({
  server: {
    handlers: {
      POST: async ({ request }) => (await load()).buildRunDecisionRoute(request),
    },
  },
});
