import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/features/settings/settings-page";
export const Route = createFileRoute("/settings")({
  component: Screen,
});
