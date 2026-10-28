import { createFileRoute } from "@tanstack/react-router";

const load = () => import("@/server/http/github-dev-session");

export const Route = createFileRoute("/api/bff/auth/github/dev-session")({
  server: {
    handlers: {
      GET: async ({ request }) => (await load()).GET(request),
    },
  },
});
