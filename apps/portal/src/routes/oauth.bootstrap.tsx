import { createFileRoute } from "@tanstack/react-router";
import { OAuthBootstrapClient } from "@/features/oauth/oauth-bootstrap-client";

export const Route = createFileRoute("/oauth/bootstrap")({
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  }),
  component: OAuthBootstrapClient,
});
