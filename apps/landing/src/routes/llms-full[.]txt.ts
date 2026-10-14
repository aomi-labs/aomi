import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/http/llms-full.txt/route");
        return handler.GET();
      },
    },
  },
});
