import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/integrations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/bff/integrations/routes");
        return handler.integrationsStatusRoute(request);
      },
      POST: async ({ request }) => {
        const handler = await import("@/server/bff/integrations/routes");
        return handler.integrationsConnectRoute(request);
      },
    },
  },
});
