import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/llms-txt");
        return handler.GET();
      },
    },
  },
});
