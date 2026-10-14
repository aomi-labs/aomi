import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/operate/model-keys")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/bff/operate/routes");
        return handler.operateModelKeysRoute(request);
      },
      POST: async ({ request }) => {
        const handler = await import("@/server/bff/operate/routes");
        return handler.operateModelKeysSaveRoute(request);
      },
      PUT: async ({ request }) => {
        const handler = await import("@/server/bff/operate/routes");
        return handler.operateModelKeysGrantsRoute(request);
      },
      DELETE: async ({ request }) => {
        const handler = await import("@/server/bff/operate/routes");
        return handler.operateModelKeysDeleteRoute(request);
      },
    },
  },
});
