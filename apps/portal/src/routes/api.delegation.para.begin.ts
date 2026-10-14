import { createFileRoute } from "@tanstack/react-router";
import { invokeHandler } from "@/server/http-handler";
import * as handlers from "@/server/http/api/delegation/para/begin/route";

export const Route = createFileRoute("/api/delegation/para/begin")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        invokeHandler(handlers.POST, request, params),
      OPTIONS: ({ request, params }) =>
        invokeHandler(handlers.OPTIONS, request, params),
    },
  },
});
