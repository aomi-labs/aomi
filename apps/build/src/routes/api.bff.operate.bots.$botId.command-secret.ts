import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/api/bff/operate/bots/$botId/command-secret",
)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await import("@/server/bff/operate/routes");
        return handler.operateBotsCommandSecretRoute(request);
      },
    },
  },
});
