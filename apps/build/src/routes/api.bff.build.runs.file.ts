import { createFileRoute } from "@tanstack/react-router";

const load = () => import("@/server/bff/build/routes");

export const Route = createFileRoute("/api/bff/build/runs/file")({
  server: {
    handlers: {
      GET: async ({ request }) => (await load()).buildRunFileRoute(request),
    },
  },
});
