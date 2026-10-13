import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/features/oauth/authorize-page";
export const Route = createFileRoute("/oauth/authorize")({
  component: Screen,
});
