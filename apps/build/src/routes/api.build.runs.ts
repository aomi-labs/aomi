import { createFileRoute } from "@tanstack/react-router";

const load = () => import("@/server/bff/build/routes");

export const Route = createFileRoute("/api/build/runs")({
  server: {
    handlers: {
      GET: async ({ request }) => (await load()).buildRunStatusRoute(request),
      POST: async ({ request }) => (await load()).createBuildRunRoute(request),
    },
  },
});
