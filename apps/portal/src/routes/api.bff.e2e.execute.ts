import { createFileRoute } from "@tanstack/react-router";
import { invokeHandler } from "@/server/http-handler";
import * as handlers from "@/server/http/api/bff/e2e/execute/route";

export const Route = createFileRoute("/api/bff/e2e/execute")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        invokeHandler(handlers.POST, request, params),
    },
  },
});
