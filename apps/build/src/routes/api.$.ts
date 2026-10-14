import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const handler = await import("@/server/http/backend-proxy");
        return handler.GET(request, {
          params: Promise.resolve({
            slug: params._splat?.split("/").filter(Boolean) ?? [],
          }),
        });
      },
      POST: async ({ request, params }) => {
        const handler = await import("@/server/http/backend-proxy");
        return handler.POST(request, {
          params: Promise.resolve({
            slug: params._splat?.split("/").filter(Boolean) ?? [],
          }),
        });
      },
      PUT: async ({ request, params }) => {
        const handler = await import("@/server/http/backend-proxy");
        return handler.PUT(request, {
          params: Promise.resolve({
            slug: params._splat?.split("/").filter(Boolean) ?? [],
          }),
        });
      },
      PATCH: async ({ request, params }) => {
        const handler = await import("@/server/http/backend-proxy");
        return handler.PATCH(request, {
          params: Promise.resolve({
            slug: params._splat?.split("/").filter(Boolean) ?? [],
          }),
        });
      },
      DELETE: async ({ request, params }) => {
        const handler = await import("@/server/http/backend-proxy");
        return handler.DELETE(request, {
          params: Promise.resolve({
            slug: params._splat?.split("/").filter(Boolean) ?? [],
          }),
        });
      },
    },
  },
});
