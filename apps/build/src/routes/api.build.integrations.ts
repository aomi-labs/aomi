import { createFileRoute } from "@tanstack/react-router";

const load = () => import("@/server/integrations/routes");

export const Route = createFileRoute("/api/build/integrations")({
  server: {
    handlers: {
      GET: async ({ request }) => (await load()).integrationsStatusRoute(request),
      POST: async ({ request }) => (await load()).integrationsConnectRoute(request),
    },
  },
});
