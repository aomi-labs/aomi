import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/auth/github/dev-session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/http/github-auth");
        return handler.githubDevSessionRoute(request);
      },
    },
  },
});
