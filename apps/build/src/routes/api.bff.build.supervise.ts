import { createFileRoute } from "@tanstack/react-router";

const load = () => import("@/server/http/build-supervisor");

export const Route = createFileRoute("/api/bff/build/supervise")({
  server: {
    handlers: {
      GET: async ({ request }) => (await load()).GET(request),
    },
  },
});
