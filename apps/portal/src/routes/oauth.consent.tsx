import { createFileRoute } from "@tanstack/react-router";
import { OAuthConsentClient } from "@/features/oauth/oauth-consent-client";

export const Route = createFileRoute("/oauth/consent")({
  component: OAuthConsentClient,
});
