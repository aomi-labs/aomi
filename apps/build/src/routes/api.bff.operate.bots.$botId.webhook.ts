import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bff/operate/bots/$botId/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const handler = await import("@/server/bff/operate/routes");
        return handler.operateBotsWebhookRoute(request);
      },
    },
  },
});
