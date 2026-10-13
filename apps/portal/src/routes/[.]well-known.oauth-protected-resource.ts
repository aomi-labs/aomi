import { createFileRoute } from "@tanstack/react-router";
import {
  agentMcpResourceMetadata,
  metadataPreflight,
  withoutBody,
} from "@/server/oauth/protected-resource-metadata";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: () => agentMcpResourceMetadata(),
      HEAD: async () => withoutBody(await agentMcpResourceMetadata()),
      OPTIONS: () => metadataPreflight(),
    },
  },
});
