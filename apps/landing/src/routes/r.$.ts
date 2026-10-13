import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/r/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const handler = await import("@/server/registry");
        return handler.GET(
          request,
          params._splat?.split("/").filter(Boolean) ?? [],
        );
      },
    },
  },
});
