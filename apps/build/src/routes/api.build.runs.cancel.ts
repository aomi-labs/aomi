import { createFileRoute } from "@tanstack/react-router";

const load = () => import("@/server/build/routes");

export const Route = createFileRoute("/api/build/runs/cancel")({
  server: {
    handlers: {
      POST: async ({ request }) => (await load()).buildRunCancelRoute(request),
    },
  },
});
