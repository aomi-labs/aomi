import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/faq.md")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/http/faq.md/route");
        return handler.GET();
      },
    },
  },
});
