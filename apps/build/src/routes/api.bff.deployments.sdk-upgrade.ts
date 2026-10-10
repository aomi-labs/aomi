import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/deployments/sdk-upgrade")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const handler = await import("@/server/bff/deploy/project-upgrade");
        return handler.projectSdkUpgradeRoute(request);
      },
    },
  },
});
