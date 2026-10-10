import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/screens/oauth/device/page";
export const Route = createFileRoute("/oauth/device")({
  component: Screen,
});
