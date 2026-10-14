import { createFileRoute } from "@tanstack/react-router";
import { invokeHandler } from "@/server/http-handler";
import * as handlers from "@/server/http/.well-known/oauth-protected-resource/[...path]/route";

export const Route = createFileRoute("/.well-known/oauth-protected-resource/$")(
  {
    server: {
      handlers: {
        GET: ({ request, params }) =>
          invokeHandler(handlers.GET, request, {
            ...params,
            path: params._splat?.split("/").filter(Boolean) ?? [],
          }),
        HEAD: ({ request, params }) =>
          invokeHandler(handlers.HEAD, request, {
            ...params,
            path: params._splat?.split("/").filter(Boolean) ?? [],
          }),
        OPTIONS: ({ request, params }) =>
          invokeHandler(handlers.OPTIONS, request, {
            ...params,
            path: params._splat?.split("/").filter(Boolean) ?? [],
          }),
      },
    },
  },
);
