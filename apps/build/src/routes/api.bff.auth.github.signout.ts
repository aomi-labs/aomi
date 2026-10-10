import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/auth/github/signout")({
  server: {
    handlers: {
      POST: async () => {
        const handler = await import("@/server/http/github-auth");
        return handler.githubSignoutRoute();
      },
    },
  },
});
