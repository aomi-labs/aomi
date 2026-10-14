import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/cli/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/http/cli-auth");
        return handler.cliStatusRoute(request);
      },
    },
  },
});
