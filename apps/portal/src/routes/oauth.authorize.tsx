import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/screens/oauth/authorize/page";
export const Route = createFileRoute("/oauth/authorize")({
  component: Screen,
});
