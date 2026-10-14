import { createFileRoute } from "@tanstack/react-router";
import { invokeHandler } from "@/server/http-handler";
import * as handlers from "@/server/http/api/delegation/privy/begin/route";

export const Route = createFileRoute("/api/delegation/privy/begin")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        invokeHandler(handlers.POST, request, params),
      OPTIONS: ({ request, params }) =>
        invokeHandler(handlers.OPTIONS, request, params),
    },
  },
});
