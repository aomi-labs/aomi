import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/device-auth/link-intent")({
  server: {
    handlers: {
      POST: ({ request }) => routes.deviceLinkIntent.POST(request),
    },
  },
});
