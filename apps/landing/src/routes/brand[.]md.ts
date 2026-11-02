import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/brand.md")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/brand-md");
        return handler.GET();
      },
    },
  },
});
