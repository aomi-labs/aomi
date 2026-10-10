import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/deployments/github-app")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/bff/deploy/github-app");
        return handler.githubAppInstallationsRoute(request);
      },
    },
  },
});
