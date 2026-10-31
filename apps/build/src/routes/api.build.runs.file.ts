import { createFileRoute } from "@tanstack/react-router";

const load = () => import("@/server/build/routes");

export const Route = createFileRoute("/api/build/runs/file")({
  server: {
    handlers: {
      GET: async ({ request }) => (await load()).buildRunFileRoute(request),
    },
  },
});
