import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/screens/device-auth/page";
export const Route = createFileRoute("/device-auth")({
  component: Screen,
});
