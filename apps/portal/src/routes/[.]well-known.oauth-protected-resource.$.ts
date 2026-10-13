import { createFileRoute } from "@tanstack/react-router";
import {
  metadataPreflight,
  resourceMetadata,
  withoutBody,
} from "@/server/oauth/protected-resource-metadata";

export const Route = createFileRoute("/.well-known/oauth-protected-resource/$")({
  server: {
    handlers: {
      GET: ({ params }) => resourceMetadata(params._splat),
      HEAD: async ({ params }) =>
        withoutBody(await resourceMetadata(params._splat)),
      OPTIONS: () => metadataPreflight(),
    },
  },
});
