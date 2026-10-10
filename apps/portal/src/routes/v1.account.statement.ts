import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/statement")({
  server: {
    handlers: {
      GET: ({ request }) => routes.statement.GET(request),
      OPTIONS: ({ request }) => routes.statement.OPTIONS(request),
    },
  },
});
