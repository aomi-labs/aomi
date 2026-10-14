import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/auth/github/claim")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/http/github-auth");
        return handler.githubClaimRoute(request);
      },
    },
  },
});
