import { createFileRoute } from "@tanstack/react-router";
import { invokeHandler } from "@/server/http-handler";
import * as handlers from "@/server/http/v1/agent/[...slug]/route";

export const Route = createFileRoute("/v1/agent/$")({
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
      PATCH: ({ request, params }) =>
        invokeHandler(handlers.PATCH, request, {
          ...params,
          slug: params._splat?.split("/").filter(Boolean) ?? [],
        }),
      DELETE: ({ request, params }) =>
        invokeHandler(handlers.DELETE, request, {
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
