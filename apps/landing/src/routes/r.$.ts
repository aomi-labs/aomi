import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/r/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const handler = await import("@/server/http/r/[...slug]/route");
        return handler.GET(request, {
          params: Promise.resolve({
            slug: params._splat?.split("/").filter(Boolean) ?? [],
          }),
        });
      },
    },
  },
});
