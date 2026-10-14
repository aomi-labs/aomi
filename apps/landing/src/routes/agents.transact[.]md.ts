import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/agents/transact.md")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/http/agents/transact.md/route");
        return handler.GET();
      },
    },
  },
});
