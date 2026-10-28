import { createFileRoute } from "@tanstack/react-router";

const load = () => import("@/server/bff/integrations/routes");

export const Route = createFileRoute("/api/bff/integrations")({
  server: {
    handlers: {
      GET: async ({ request }) => (await load()).integrationsStatusRoute(request),
      POST: async ({ request }) => (await load()).integrationsConnectRoute(request),
    },
  },
});
