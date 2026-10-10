import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/api/public/catalog/$kind")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        routes.publicCatalog.GET(request, { params: Promise.resolve(params) }),
      OPTIONS: () => routes.publicCatalog.OPTIONS(),
    },
  },
});
