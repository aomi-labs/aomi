import { createFileRoute } from "@tanstack/react-router";

const load = () => import("@/server/build/routes");

export const Route = createFileRoute("/api/build/runs/download")({
  server: {
    handlers: {
      GET: async ({ request }) => (await load()).buildRunDownloadRoute(request),
    },
  },
});
