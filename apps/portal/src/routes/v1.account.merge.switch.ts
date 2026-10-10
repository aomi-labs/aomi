import { createFileRoute } from "@tanstack/react-router";
import { routes } from "@/server/bff/routes";

export const Route = createFileRoute("/v1/account/merge/switch")({
  server: {
    handlers: {
      POST: ({ request }) => routes.mergeSwitch.POST(request),
      OPTIONS: ({ request }) => routes.mergeSwitch.OPTIONS(request),
    },
  },
});
