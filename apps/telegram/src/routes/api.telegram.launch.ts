import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/telegram/launch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { POST } = await import("@/server/telegram-launch");
        return POST(request);
      },
    },
  },
});
