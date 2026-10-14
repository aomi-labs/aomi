import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/operate/bots")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/bff/operate/routes");
        return handler.operateBotsRoute(request);
      },
      POST: async ({ request }) => {
        const handler = await import("@/server/bff/operate/routes");
        return handler.operateBotsCreateRoute(request);
      },
      DELETE: async ({ request }) => {
        const handler = await import("@/server/bff/operate/routes");
        return handler.operateBotsDeleteRoute(request);
      },
      PATCH: async ({ request }) => {
        const handler = await import("@/server/bff/operate/routes");
        return handler.operateBotsUpdateRoute(request);
      },
    },
  },
});
