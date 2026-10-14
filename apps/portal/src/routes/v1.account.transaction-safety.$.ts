import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/transaction-safety/$")({
  server: {
    handlers: {
      GET: ({ request }) => routes.transactionSafety.GET(request),
      PUT: ({ request }) => routes.transactionSafety.PUT(request),
      OPTIONS: ({ request }) => routes.transactionSafety.OPTIONS(request),
    },
  },
});
