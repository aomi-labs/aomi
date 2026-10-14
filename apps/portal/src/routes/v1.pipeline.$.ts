import { createFileRoute } from "@tanstack/react-router";
import { invokeHandler } from "@/server/http-handler";
import * as handlers from "@/server/http/v1/pipeline/[...slug]/route";

export const Route = createFileRoute("/v1/pipeline/$")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        invokeHandler(handlers.GET, request, {
          ...params,
          slug: params._splat?.split("/").filter(Boolean) ?? [],
        }),
      POST: ({ request, params }) =>
        invokeHandler(handlers.POST, request, {
          ...params,
          slug: params._splat?.split("/").filter(Boolean) ?? [],
        }),
      OPTIONS: ({ request, params }) =>
        invokeHandler(handlers.OPTIONS, request, {
          ...params,
          slug: params._splat?.split("/").filter(Boolean) ?? [],
        }),
    },
  },
});
