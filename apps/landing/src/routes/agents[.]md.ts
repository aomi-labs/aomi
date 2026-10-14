import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/agents.md")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/http/agents.md/route");
        return handler.GET();
      },
    },
  },
});
