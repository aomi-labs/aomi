import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/http/api/proxy/route");
        return handler.GET(request);
      },
      POST: async ({ request }) => {
        const handler = await import("@/server/http/api/proxy/route");
        return handler.POST(request);
      },
      PUT: async ({ request }) => {
        const handler = await import("@/server/http/api/proxy/route");
        return handler.PUT(request);
      },
      PATCH: async ({ request }) => {
        const handler = await import("@/server/http/api/proxy/route");
        return handler.PATCH(request);
      },
      DELETE: async ({ request }) => {
        const handler = await import("@/server/http/api/proxy/route");
        return handler.DELETE(request);
      },
    },
  },
});
