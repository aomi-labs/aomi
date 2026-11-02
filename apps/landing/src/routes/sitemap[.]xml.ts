import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/sitemap");
        return handler.GET();
      },
    },
  },
});
