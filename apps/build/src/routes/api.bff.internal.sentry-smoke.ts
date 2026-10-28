import { createFileRoute } from "@tanstack/react-router";

const load = () => import("@/server/http/sentry-smoke");
const notFound = async () => (await load()).GET();

export const Route = createFileRoute("/api/bff/internal/sentry-smoke")({
  server: {
    handlers: {
      POST: async ({ request }) => (await load()).POST(request),
      GET: notFound,
      PUT: notFound,
      PATCH: notFound,
      DELETE: notFound,
      OPTIONS: notFound,
    },
  },
});
