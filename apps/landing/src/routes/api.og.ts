import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/og")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/og-image");
        return handler.GET(request);
      },
    },
  },
});
