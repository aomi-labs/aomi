import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/brand.md")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/http/brand.md/route");
        return handler.GET();
      },
    },
  },
});
