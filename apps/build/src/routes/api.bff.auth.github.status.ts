import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/auth/github/status")({
  server: {
    handlers: {
      GET: async () => {
        const handler = await import("@/server/http/github-auth");
        return handler.githubSessionRoute();
      },
    },
  },
});
