import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/http/sitemap.xml/route");
        return handler.GET();
      },
    },
  },
});
