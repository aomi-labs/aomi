import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/screens/dev/integrations-preview/page";

export const Route = createFileRoute("/dev/integrations-preview")({
  component: Screen,
});
