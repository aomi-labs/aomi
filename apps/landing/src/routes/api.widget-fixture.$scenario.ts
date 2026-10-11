import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/widget-fixture/$scenario")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const handler =
          await import("@/server/http/api/widget-fixture/[scenario]/[[...path]]/route");
        return handler.GET(request, {
          params: Promise.resolve({
            scenario: params.scenario,
          }),
        });
      },
      POST: async ({ request, params }) => {
        const handler =
          await import("@/server/http/api/widget-fixture/[scenario]/[[...path]]/route");
        return handler.POST(request, {
          params: Promise.resolve({
            scenario: params.scenario,
          }),
        });
      },
    },
  },
});
