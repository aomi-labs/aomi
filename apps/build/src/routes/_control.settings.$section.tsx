import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/features/settings/settings-section";

export const Route = createFileRoute("/_control/settings/$section")({
  component: SettingsSection,
});

function SettingsSection() {
  return <Screen params={Route.useParams()} />;
}
