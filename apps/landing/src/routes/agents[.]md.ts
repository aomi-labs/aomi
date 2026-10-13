import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/agents.md")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/agents-md");
        return handler.GET();
      },
    },
  },
});
