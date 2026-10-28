import { createFileRoute } from "@tanstack/react-router";

const load = () => import("@/server/bff/build/routes");

export const Route = createFileRoute("/api/bff/build/runs/decision")({
  server: {
    handlers: {
      POST: async ({ request }) => (await load()).buildRunDecisionRoute(request),
    },
  },
});
