import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/features/oauth/bootstrap-page";
export const Route = createFileRoute("/oauth/bootstrap")({
  component: Screen,
});
