import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/device-auth/grant")({
  server: {
    handlers: {
      POST: ({ request }) => routes.deviceGrant.POST(request),
    },
  },
});
