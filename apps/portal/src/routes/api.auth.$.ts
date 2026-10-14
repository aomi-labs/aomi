import { createFileRoute } from "@tanstack/react-router";
import { invokeHandler } from "@/server/http-handler";
import * as handlers from "@/server/http/api/auth/[...all]/route";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        invokeHandler(handlers.GET, request, {
          ...params,
          all: params._splat?.split("/").filter(Boolean) ?? [],
        }),
      POST: ({ request, params }) =>
        invokeHandler(handlers.POST, request, {
          ...params,
          all: params._splat?.split("/").filter(Boolean) ?? [],
        }),
      PUT: ({ request, params }) =>
        invokeHandler(handlers.PUT, request, {
          ...params,
          all: params._splat?.split("/").filter(Boolean) ?? [],
        }),
      PATCH: ({ request, params }) =>
        invokeHandler(handlers.PATCH, request, {
          ...params,
          all: params._splat?.split("/").filter(Boolean) ?? [],
        }),
      DELETE: ({ request, params }) =>
        invokeHandler(handlers.DELETE, request, {
          ...params,
          all: params._splat?.split("/").filter(Boolean) ?? [],
        }),
      OPTIONS: ({ request, params }) =>
        invokeHandler(handlers.OPTIONS, request, {
          ...params,
          all: params._splat?.split("/").filter(Boolean) ?? [],
        }),
    },
  },
});
