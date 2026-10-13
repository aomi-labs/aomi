import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/features/device-auth/device-auth-page";
export const Route = createFileRoute("/device-auth")({
  component: Screen,
});
