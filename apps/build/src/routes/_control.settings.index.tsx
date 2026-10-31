import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/features/settings/settings-overview";

export const Route = createFileRoute("/_control/settings/")({
  component: () => <Screen />,
});
