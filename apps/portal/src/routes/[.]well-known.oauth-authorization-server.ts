import { createFileRoute } from "@tanstack/react-router";
import * as authorizationServer from "@/server/oauth/authorization-server-metadata";

export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: {
    handlers: {
      GET: ({ request }) => authorizationServer.GET(request),
      HEAD: ({ request }) => authorizationServer.HEAD(request),
      OPTIONS: () => authorizationServer.OPTIONS(),
    },
  },
});
