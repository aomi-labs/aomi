import { createFileRoute } from "@tanstack/react-router";
import { invokeHandler } from "@/server/http-handler";
import * as handlers from "@/server/http/api/bff/e2e/wallet/route";

export const Route = createFileRoute("/api/bff/e2e/wallet")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        invokeHandler(handlers.GET, request, params),
    },
  },
});
