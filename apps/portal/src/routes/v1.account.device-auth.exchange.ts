import { createFileRoute } from "@tanstack/react-router";
import { invokeHandler } from "@/server/http-handler";
import * as handlers from "@/server/http/v1/account/device-auth/exchange/route";

export const Route = createFileRoute("/v1/account/device-auth/exchange")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        invokeHandler(handlers.POST, request, params),
    },
  },
});
