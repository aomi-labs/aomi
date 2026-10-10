import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/build/runs/download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/bff/build/routes");
        return handler.buildRunDownloadRoute(request);
      },
    },
  },
});
