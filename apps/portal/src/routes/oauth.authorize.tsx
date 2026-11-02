import { createFileRoute } from "@tanstack/react-router";
import { OAuthAuthorizeClient } from "@/features/oauth/oauth-authorize-client";

export const Route = createFileRoute("/oauth/authorize")({
  component: OAuthAuthorizeClient,
});
