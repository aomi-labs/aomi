import { createFileRoute } from "@tanstack/react-router";
import { DeviceAuthClient } from "@/features/device-auth/device-auth-client";

export const Route = createFileRoute("/device-auth")({
  component: DeviceAuthClient,
});
