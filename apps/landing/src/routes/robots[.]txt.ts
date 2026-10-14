import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/http/robots.txt/route");
        return handler.GET();
      },
    },
  },
});
