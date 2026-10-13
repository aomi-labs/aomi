import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

const begin = routes.delegationBegin("para");

export const Route = createFileRoute("/api/delegation/para/begin")({
  server: {
    handlers: {
      POST: ({ request }) => begin.POST(request),
      OPTIONS: ({ request }) => begin.OPTIONS(request),
    },
  },
});
