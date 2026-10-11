import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/http/index/route");
        return handler.GET();
      },
    },
  },
});
