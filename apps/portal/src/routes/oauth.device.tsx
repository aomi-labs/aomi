import { createFileRoute } from "@tanstack/react-router";
import { OAuthDeviceClient } from "@/features/oauth/oauth-device-client";

export const Route = createFileRoute("/oauth/device")({
  component: OAuthDeviceClient,
});
