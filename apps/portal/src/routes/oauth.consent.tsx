import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/screens/oauth/consent/page";
export const Route = createFileRoute("/oauth/consent")({
  component: Screen,
});
