import { createFileRoute } from "@tanstack/react-router";
import { invokeHandler } from "@/server/http-handler";
import * as handlers from "@/server/http/api/auth/widget/telegram/custom-auth/route";

export const Route = createFileRoute("/api/auth/widget/telegram/custom-auth")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        invokeHandler(handlers.POST, request, params),
      OPTIONS: ({ request, params }) =>
        invokeHandler(handlers.OPTIONS, request, params),
    },
  },
});
