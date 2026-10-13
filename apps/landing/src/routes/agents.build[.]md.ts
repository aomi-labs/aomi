import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/agents/build.md")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/agents-build-md");
        return handler.GET();
      },
    },
  },
});
