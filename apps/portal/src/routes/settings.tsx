import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/screens/settings/page";
export const Route = createFileRoute("/settings")({
  component: Screen,
});
