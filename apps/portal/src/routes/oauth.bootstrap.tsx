import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/screens/oauth/bootstrap/page";
export const Route = createFileRoute("/oauth/bootstrap")({
  component: Screen,
});
