import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/cli/exchange")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const handler = await import("@/server/http/cli-auth");
        return handler.cliExchangeRoute(request);
      },
    },
  },
});
