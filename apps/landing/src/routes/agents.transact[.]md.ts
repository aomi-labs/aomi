import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/agents/transact.md")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/agents-transact-md");
        return handler.GET();
      },
    },
  },
});
