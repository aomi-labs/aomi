import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/home");
        return handler.GET();
      },
    },
  },
});
