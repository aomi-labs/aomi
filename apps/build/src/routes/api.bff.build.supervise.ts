import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/build/supervise")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/http/build-supervisor");
        return handler.GET(request);
      },
    },
  },
});
