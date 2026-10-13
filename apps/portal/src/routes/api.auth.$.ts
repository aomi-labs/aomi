import { createFileRoute } from "@tanstack/react-router";
import {
  handleAuth,
  handleAuthPreflight,
} from "@/server/oauth/auth-handler";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request),
      PUT: ({ request }) => handleAuth(request),
      PATCH: ({ request }) => handleAuth(request),
      DELETE: ({ request }) => handleAuth(request),
      OPTIONS: ({ request }) => handleAuthPreflight(request),
    },
  },
});
