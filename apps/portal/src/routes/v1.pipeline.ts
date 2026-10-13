import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/pipeline")({
  server: {
    handlers: {
      GET: ({ request }) => routes.pipeline.GET(request),
      OPTIONS: ({ request }) => routes.pipeline.OPTIONS(request),
    },
  },
});
